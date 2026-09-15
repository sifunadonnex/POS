import {
  allowedAuthPath,
  isIdle,
  needsMfa,
  type SecuritySession,
} from './security-policy.js';
import { parseSmtpEnvironment } from './smtp.config.js';
import { staffInput } from './staff-admin.input.js';

const now = Date.now();
function session(): SecuritySession {
  return {
    user: {
      id: 'manager',
      role: 'manager',
      disabled: false,
      emailVerified: true,
      twoFactorEnabled: true,
    },
    session: {
      id: 'session',
      mfaVerified: true,
      lastActivityAt: new Date(now),
    },
  };
}
describe('server security policy', () => {
  it('requires an actual MFA proof for this session, including already-enrolled managers', () => {
    const value = session();
    expect(needsMfa(value)).toBe(false);
    value.session.mfaVerified = false;
    expect(needsMfa(value)).toBe(true);
    value.user.twoFactorEnabled = false;
    expect(needsMfa(value)).toBe(true);
    value.user.role = 'cashier';
    expect(needsMfa(value)).toBe(false);
    value.user.twoFactorEnabled = true;
    expect(needsMfa(value)).toBe(true);
  });
  it('expires at the idle boundary and rejects missing or invalid activity timestamps', () => {
    const value = session();
    value.session.lastActivityAt = new Date(now - 899_999);
    expect(isIdle(value, now)).toBe(false);
    value.session.lastActivityAt = new Date(now - 900_000);
    expect(isIdle(value, now)).toBe(true);
    for (const time of [undefined, 'invalid', new Date(now + 600_001)]) {
      value.session.lastActivityAt = time;
      expect(isIdle(value, now)).toBe(true);
    }
  });
  it.each([
    '/sign-up/email',
    '/update-user',
    '/two-factor/disable',
    '/two-factor/view-backup-codes',
    '/admin/set-role',
  ])('blocks unapproved auth operation %s', (path) =>
    expect(allowedAuthPath(path)).toBe(false),
  );
  it('rejects client-supplied security fields during staff creation', () => {
    expect(() =>
      staffInput({
        name: 'Test',
        email: 'test@example.test',
        role: 'manager',
        password: 'valid-password-123',
        reason: 'New employee',
        emailVerified: true,
      }),
    ).toThrow('Unexpected');
  });
});
describe('SMTP configuration', () => {
  const env = {
    AUTH_EMAIL_ENABLED: 'true',
    SMTP_HOST: 'smtp.example.test',
    SMTP_USER: 'staff@example.test',
    SMTP_PASSWORD: 'private-mail-password',
    SMTP_FROM: 'staff@example.test',
  };
  it('keeps delivery off until explicitly configured', () =>
    expect(parseSmtpEnvironment({})).toBeNull());
  it('accepts implicit TLS and STARTTLS ports only', () => {
    expect(parseSmtpEnvironment(env)?.port).toBe(587);
    expect(parseSmtpEnvironment({ ...env, SMTP_PORT: '465' })?.port).toBe(465);
    expect(() => parseSmtpEnvironment({ ...env, SMTP_PORT: '25' })).toThrow(
      '465 or 587',
    );
  });
  it('rejects missing credentials and injected mail headers without echoing secrets', () => {
    for (const invalid of [
      { ...env, SMTP_USER: 'user\r\nBcc: attacker' },
      { ...env, SMTP_PASSWORD: '' },
      { ...env, SMTP_FROM: 'staff@example.test,attacker@example.test' },
    ]) {
      try {
        parseSmtpEnvironment(invalid);
        throw new Error('Expected rejection');
      } catch (error) {
        expect(String(error)).toContain('Configure SMTP');
        expect(String(error)).not.toContain(env.SMTP_PASSWORD);
      }
    }
  });
});
