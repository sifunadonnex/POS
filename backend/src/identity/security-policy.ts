export const IDLE_SECONDS = 15 * 60;

export type SecuritySession = {
  user: {
    id: string;
    role?: unknown;
    disabled?: unknown;
    emailVerified: boolean;
    twoFactorEnabled?: unknown;
  };
  session: {
    id: string;
    mfaVerified?: unknown;
    lastActivityAt?: unknown;
  };
};

export function isIdle(session: SecuritySession, now = Date.now()): boolean {
  const value = session.session.lastActivityAt;
  const time =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'string'
        ? Date.parse(value)
        : NaN;
  return (
    !Number.isFinite(time) ||
    time > now + 60_000 ||
    now - time >= IDLE_SECONDS * 1000
  );
}

export function needsMfa(session: SecuritySession): boolean {
  return (
    (session.user.role === 'manager' ||
      session.user.twoFactorEnabled === true) &&
    (session.user.twoFactorEnabled !== true ||
      session.session.mfaVerified !== true)
  );
}

export function allowedAuthPath(path: string): boolean {
  return [
    '/sign-in/email',
    '/sign-out',
    '/get-session',
    '/ok',
    '/request-password-reset',
    '/reset-password',
    '/reset-password/:token',
    '/send-verification-email',
    '/verify-email',
    '/change-password',
    '/verify-password',
    '/two-factor/enable',
    '/two-factor/verify-totp',
    '/two-factor/verify-backup-code',
    '/two-factor/generate-backup-codes',
  ].includes(path);
}
