import { parseAuthEnvironment } from './auth.config.js';
import { parseStaffInput } from './provision-staff.js';

const secret = 'a9e0c4158f264d6aa381b06221d5e488';
describe('identity configuration', () => {
  it('requires a secret without echoing its value', () => {
    expect(() =>
      parseAuthEnvironment({ BETTER_AUTH_SECRET: 'private' }),
    ).toThrow('at least 32');
  });
  it('accepts local development but requires HTTPS in production', () => {
    expect(
      parseAuthEnvironment({
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: 'http://localhost:5173',
      }).secureCookies,
    ).toBe(false);
    expect(() =>
      parseAuthEnvironment({
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: 'http://localhost:5173',
        NODE_ENV: 'production',
      }),
    ).toThrow('HTTPS');
    expect(
      parseAuthEnvironment({
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: 'https://pos.example.test',
        NODE_ENV: 'production',
      }).secureCookies,
    ).toBe(true);
  });
  it('allows production HTTP only for the loopback-only edge runtime', () => {
    expect(
      parseAuthEnvironment({
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: 'http://127.0.0.1:3000',
        NODE_ENV: 'production',
        PAYGO_RUNTIME_MODE: 'edge',
      }).secureCookies,
    ).toBe(false);
    expect(() =>
      parseAuthEnvironment({
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: 'http://192.168.1.10:3000',
        NODE_ENV: 'production',
        PAYGO_RUNTIME_MODE: 'edge',
      }),
    ).toThrow('HTTPS');
  });
  it.each([
    'https://user:password@example.test',
    'https://example.test/path',
    'http://example.test',
    'https://example.test?x=1',
  ])('rejects unsafe origin %s', (url) => {
    expect(() =>
      parseAuthEnvironment({
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: url,
      }),
    ).toThrow('HTTPS origin');
  });
  it('validates staff roles and password length', () => {
    expect(() => parseStaffInput({ STAFF_ROLE: 'admin' })).toThrow(
      'Provide valid',
    );
  });
});
