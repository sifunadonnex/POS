import { parseEnvironment } from './environment.js';
import { databaseOptions } from '../database/database.options.js';

const base = {
  DATABASE_URL: 'postgresql://test:fake@localhost/pay_and_go_test',
};

describe('environment configuration', () => {
  it('uses bounded defaults and verified TLS', () => {
    const config = parseEnvironment(base);
    expect(config.port).toBe(3000);
    expect(databaseOptions(config)).toMatchObject({
      max: 5,
      ssl: { rejectUnauthorized: true },
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
    });
  });

  it.each(['', 'abc', '0', '-1', '1.5', '65536'])(
    'rejects invalid port %s',
    (port) => {
      expect(() => parseEnvironment({ ...base, PORT: port })).toThrow('PORT');
    },
  );

  it.each([
    '',
    'https://user:secret@localhost/db',
    'postgresql://localhost/db',
    'postgresql://user@localhost/',
    'postgresql://user@localhost/db?sslmode=no-verify',
  ])('rejects unsafe or incomplete URLs without echoing credentials', (url) => {
    expect(() => parseEnvironment({ DATABASE_URL: url })).toThrow(
      /^DATABASE_URL must be/,
    );
  });

  it('rejects missing configuration and invalid modes/pool limits', () => {
    expect(() => parseEnvironment({})).toThrow('DATABASE_URL');
    expect(() => parseEnvironment({ ...base, NODE_ENV: 'staging' })).toThrow(
      'NODE_ENV',
    );
    expect(() =>
      parseEnvironment({ ...base, DATABASE_POOL_MAX: '21' }),
    ).toThrow('DATABASE_POOL_MAX');
    expect(() =>
      parseEnvironment({ ...base, DATABASE_TLS: 'insecure' }),
    ).toThrow('DATABASE_TLS');
  });

  it('allows unencrypted loopback but rejects unencrypted remote connections', () => {
    expect(
      databaseOptions(parseEnvironment({ ...base, DATABASE_TLS: 'disable' }))
        .ssl,
    ).toBe(false);
    expect(() =>
      parseEnvironment({
        DATABASE_URL: 'postgresql://user:fake@db.example.com/db',
        DATABASE_TLS: 'disable',
      }),
    ).toThrow('loopback');
  });
});
