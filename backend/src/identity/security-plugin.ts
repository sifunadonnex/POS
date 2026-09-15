import { createHmac } from 'node:crypto';
import type { BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from 'better-auth/api';
import type { Pool } from 'pg';
import type { AuthConfig } from './auth.config.js';
import { allowedAuthPath, needsMfa } from './security-policy.js';
import { SecurityStore } from './security-store.js';

const mfaVerification = [
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
];
const emailRequests = ['/request-password-reset', '/send-verification-email'];
const sessionOperations = [
  '/get-session',
  '/change-password',
  '/verify-password',
  '/two-factor/enable',
  '/two-factor/generate-backup-codes',
];

export function securityPlugin(
  pool: Pool,
  config: AuthConfig,
): BetterAuthPlugin {
  const store = new SecurityStore(pool);
  return {
    id: 'paygo-security',
    hooks: {
      before: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            const path = ctx.path;
            const method = ctx.request?.method ?? ctx.method;
            const origin =
              ctx.request?.headers.get('origin') ?? ctx.headers?.get('origin');
            if (
              !allowedAuthPath(path) ||
              (method &&
                !['GET', 'HEAD'].includes(method) &&
                origin !== config.baseURL)
            ) {
              await store.audit({ action: 'auth.denied', outcome: 'denied' });
              throw new APIError('FORBIDDEN', {
                message: 'This authentication operation is not available.',
              });
            }
            if (emailRequests.includes(path) && !config.smtp) {
              throw new APIError('SERVICE_UNAVAILABLE', {
                message: 'Email delivery is not configured.',
              });
            }
            // Shared tills always require the second factor and nonpersistent cookies.
            if (ctx.body && typeof ctx.body === 'object') {
              if (
                ctx.body.trustDevice === true ||
                ctx.body.disableSession === true ||
                (path === '/two-factor/enable' && ctx.body.method === 'otp')
              ) {
                throw new APIError('FORBIDDEN', {
                  message: 'This authentication option is not available.',
                });
              }
              if (path === '/sign-in/email') ctx.body.rememberMe = false;
              if (path === '/change-password')
                ctx.body.revokeOtherSessions = true;
            }
            if (
              sessionOperations.includes(path) ||
              mfaVerification.includes(path)
            ) {
              const session = await getSessionFromCtx(ctx);
              if (session) {
                await store.requireActive(session);
                if (
                  needsMfa(session) &&
                  !mfaVerification.includes(path) &&
                  path !== '/get-session' &&
                  !(
                    path === '/two-factor/enable' &&
                    !session.user.twoFactorEnabled
                  )
                ) {
                  throw new APIError('FORBIDDEN', {
                    message: 'Complete two-factor authentication first.',
                  });
                }
              }
            }
          }),
        },
      ],
      // This plugin follows twoFactor(), so a pending challenge cannot be logged as a completed login.
      after: [
        {
          matcher: (ctx) => !['/get-session', '/ok'].includes(ctx.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => {
            const result: unknown = ctx.context.returned;
            const failed = isAPIError(result) && result.statusCode >= 400;
            const challenge =
              typeof result === 'object' &&
              result !== null &&
              'twoFactorRedirect' in result &&
              result.twoFactorRedirect === true;
            const session = ctx.context.newSession ?? ctx.context.session;
            if (!failed && mfaVerification.includes(ctx.path) && session) {
              await store.requireActive(session);
              await store.confirmMfa(session.session.id);
            }
            const email: unknown = ctx.body?.email;
            const emailKey =
              typeof email === 'string' && email.length <= 254
                ? createHmac('sha256', config.secret)
                    .update(`audit-email:${email.trim().toLowerCase()}`)
                    .digest('hex')
                : undefined;
            await store.audit({
              actorId: session?.user.id,
              subjectId: session?.user.id,
              action: `auth${ctx.path.replaceAll('/', '.').replace(':token', 'callback')}`,
              outcome: failed ? 'failure' : challenge ? 'challenge' : 'success',
              detail: emailKey ? { emailKey } : {},
            });
          }),
        },
      ],
    },
  };
}
