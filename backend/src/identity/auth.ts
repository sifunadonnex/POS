import {
  betterAuth,
  type Auth,
  type BetterAuthOptions,
  type BetterAuthPlugin,
} from 'better-auth';
import { APIError } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins/two-factor';
import type { Pool } from 'pg';
import type { AuthConfig } from './auth.config.js';
import { Logger } from '@nestjs/common';
import type { AuthMailer } from './auth-mail.js';
import { securityPlugin } from './security-plugin.js';

type IdentityOptions = BetterAuthOptions & {
  plugins: [ReturnType<typeof twoFactor>, BetterAuthPlugin];
  user: {
    additionalFields: {
      role: {
        type: 'string';
        required: true;
        defaultValue: 'cashier';
        input: false;
      };
      disabled: {
        type: 'boolean';
        required: true;
        defaultValue: false;
        input: false;
      };
    };
  };
  session: {
    additionalFields: {
      mfaVerified: {
        type: 'boolean';
        required: true;
        defaultValue: false;
        input: false;
      };
      lastActivityAt: {
        type: 'date';
        required: true;
        defaultValue: () => Date;
        input: false;
      };
    };
  };
};

export function createAuth(
  pool: Pool,
  config: AuthConfig,
  mailer: AuthMailer,
): Auth<IdentityOptions> {
  const logger = new Logger('Identity');
  return betterAuth<IdentityOptions>({
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
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      sendResetPassword: ({ user, token }) =>
        mailer.send({
          userId: user.id,
          to: user.email,
          token,
          purpose: 'reset',
        }),
    },
    emailVerification: {
      expiresIn: 30 * 60,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      sendVerificationEmail: ({ user, token }) =>
        mailer.send({
          userId: user.id,
          to: user.email,
          token,
          purpose: 'verify',
        }),
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: true,
          defaultValue: 'cashier',
          input: false,
        },
        disabled: {
          type: 'boolean',
          required: true,
          defaultValue: false,
          input: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
      additionalFields: {
        mfaVerified: {
          type: 'boolean',
          required: true,
          defaultValue: false,
          input: false,
        },
        lastActivityAt: {
          type: 'date',
          required: true,
          defaultValue: () => new Date(),
          input: false,
        },
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const user = await pool.query<{
              disabled: boolean;
              emailVerified: boolean;
            }>('SELECT disabled, "emailVerified" FROM "user" WHERE id = $1', [
              session.userId,
            ]);
            if (
              !user.rows[0] ||
              user.rows[0].disabled ||
              !user.rows[0].emailVerified
            ) {
              throw new APIError('UNAUTHORIZED', {
                message: 'Invalid email or password.',
              });
            }
            return {
              data: {
                ...session,
                mfaVerified: false,
                lastActivityAt: new Date(),
                expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
              },
            };
          },
        },
      },
    },
    account: { accountLinking: { enabled: false } },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 3 },
        '/reset-password': { window: 60, max: 5 },
        '/change-password': { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: config.secureCookies,
      cookiePrefix: 'pay-and-go',
      ipAddress: { ipAddressHeaders: ['x-paygo-client-ip'] },
    },
    plugins: [
      twoFactor({ issuer: 'Pay & Go', twoFactorCookieMaxAge: 300 }),
      securityPlugin(pool, config),
    ],
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
