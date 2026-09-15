import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import type { Pool } from 'pg';
import type { AuthConfig } from './auth.config.js';
import { Logger } from '@nestjs/common';

export function createAuth(pool: Pool, config: AuthConfig) {
  const logger = new Logger('Identity');
  return betterAuth({
    appName: 'Pay & Go',
    baseURL: config.baseURL,
    basePath: '/api/auth',
    secret: config.secret,
    database: pool,
    trustedOrigins: [config.baseURL],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: true,
          defaultValue: 'cashier',
          input: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => ({
            data: {
              ...session,
              expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
            },
          }),
        },
      },
    },
    account: { accountLinking: { enabled: false } },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 5 } },
    },
    advanced: {
      useSecureCookies: config.secureCookies,
      cookiePrefix: 'pay-and-go',
      ipAddress: { ipAddressHeaders: ['x-paygo-client-ip'] },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.request &&
          !['GET', 'HEAD'].includes(ctx.request.method) &&
          ctx.request.headers.get('origin') !== config.baseURL
        ) {
          throw new APIError('FORBIDDEN', {
            message: 'Untrusted request origin.',
          });
        }
        if (
          !['/sign-in/email', '/sign-out', '/get-session', '/ok'].includes(
            ctx.path,
          )
        ) {
          throw new APIError('FORBIDDEN', {
            message: 'This authentication operation is not available.',
          });
        }
      }),
    },
    // Do not log passwords, session tokens, database URLs or raw adapter errors.
    logger: {
      level: 'error',
      log: () =>
        logger.error(
          'Authentication operation failed; inspect configuration and database health',
        ),
    },
  });
}
export type PayGoAuth = ReturnType<typeof createAuth>;
export type StaffSession = PayGoAuth['$Infer']['Session'];
export const AUTH = Symbol('AUTH');
