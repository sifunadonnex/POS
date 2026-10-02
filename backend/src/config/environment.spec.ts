import { parseEnvironment } from './environment.js';
import { databaseOptions } from '../database/database.options.js';

const base = {
  DATABASE_URL: 'postgresql://test:fake@localhost/pay_and_go_test',
};

describe('environment configuration', () => {
  it('uses bounded defaults and verified TLS', () => {
    const config = parseEnvironment(base);
    expect(config.port).toBe(3000);
    expect(config.runtime).toEqual({ mode: 'hosted', storeId: null });
    expect(config.sync).toBeNull();
    expect(databaseOptions(config)).toMatchObject({
      max: 5,
      ssl: { rejectUnauthorized: true },
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
    });
  });

  it('requires a stable store UUID for the cash-only edge runtime', () => {
    const edge = parseEnvironment({
      ...base,
      PAYGO_RUNTIME_MODE: 'edge',
      PAYGO_STORE_ID: '11111111-1111-4111-8111-111111111111',
    });
    expect(edge.runtime).toEqual({
      mode: 'edge',
      storeId: '11111111-1111-4111-8111-111111111111',
    });
    expect(() =>
      parseEnvironment({ ...base, PAYGO_RUNTIME_MODE: 'edge' }),
    ).toThrow('PAYGO_STORE_ID');
    expect(() =>
      parseEnvironment({ ...base, PAYGO_RUNTIME_MODE: 'browser' }),
    ).toThrow('PAYGO_RUNTIME_MODE');
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

  it('keeps Daraja disabled by default and validates a complete configuration', () => {
    expect(parseEnvironment(base).daraja).toBeNull();
    const daraja = parseEnvironment({
      ...base,
      DARAJA_ENABLED: 'true',
      DARAJA_ENVIRONMENT: 'sandbox',
      DARAJA_CONSUMER_KEY: 'consumer-key',
      DARAJA_CONSUMER_SECRET: 'consumer-secret',
      DARAJA_SHORTCODE: '174379',
      DARAJA_PASSKEY: 'a-secure-online-passkey',
      DARAJA_TRANSACTION_TYPE: 'CustomerPayBillOnline',
      DARAJA_CALLBACK_URL:
        'https://payments.example.test/api/payment-attempts/mpesa/callback',
      DARAJA_CALLBACK_TOKEN: 'a'.repeat(32),
    }).daraja;
    expect(daraja).toMatchObject({
      environment: 'sandbox',
      shortCode: '174379',
      transactionType: 'CustomerPayBillOnline',
    });
  });

  it('rejects incomplete or unsafe Daraja configuration', () => {
    expect(() => parseEnvironment({ ...base, DARAJA_ENABLED: 'yes' })).toThrow(
      'DARAJA_ENABLED',
    );
    expect(() => parseEnvironment({ ...base, DARAJA_ENABLED: 'true' })).toThrow(
      'DARAJA_SHORTCODE',
    );
    expect(() =>
      parseEnvironment({
        ...base,
        DARAJA_ENABLED: 'true',
        DARAJA_CONSUMER_KEY: 'consumer-key',
        DARAJA_CONSUMER_SECRET: 'consumer-secret',
        DARAJA_SHORTCODE: '174379',
        DARAJA_PASSKEY: 'a-secure-online-passkey',
        DARAJA_CALLBACK_URL: 'http://localhost/callback',
        DARAJA_CALLBACK_TOKEN: 'a'.repeat(32),
      }),
    ).toThrow('HTTPS URL');
  });

  it('keeps provider payments disabled in edge mode', () => {
    expect(() =>
      parseEnvironment({
        ...base,
        PAYGO_RUNTIME_MODE: 'edge',
        PAYGO_STORE_ID: '11111111-1111-4111-8111-111111111111',
        DARAJA_ENABLED: 'true',
        DARAJA_ENVIRONMENT: 'sandbox',
        DARAJA_CONSUMER_KEY: 'consumer-key',
        DARAJA_CONSUMER_SECRET: 'consumer-secret',
        DARAJA_SHORTCODE: '174379',
        DARAJA_PASSKEY: 'a-secure-online-passkey',
        DARAJA_CALLBACK_URL:
          'https://payments.example.test/api/payment-attempts/mpesa/callback',
        DARAJA_CALLBACK_TOKEN: 'a'.repeat(32),
      }),
    ).toThrow('edge mode');
  });

  it('validates hosted ingestion and edge delivery configuration', () => {
    const hosted = parseEnvironment({
      ...base,
      PAYGO_SYNC_ENABLED: 'true',
      PAYGO_SYNC_STORE_ID: '11111111-1111-4111-8111-111111111111',
      PAYGO_SYNC_SECRET: 's'.repeat(32),
    });
    expect(hosted.sync).toMatchObject({
      storeId: '11111111-1111-4111-8111-111111111111',
      targetUrl: null,
      pollSeconds: 10,
    });

    const edge = parseEnvironment({
      ...base,
      PAYGO_RUNTIME_MODE: 'edge',
      PAYGO_STORE_ID: '11111111-1111-4111-8111-111111111111',
      PAYGO_SYNC_ENABLED: 'true',
      PAYGO_SYNC_SECRET: 's'.repeat(32),
      PAYGO_SYNC_URL: 'https://pos.example.test/api/sync/events',
      PAYGO_SYNC_POLL_SECONDS: '30',
    });
    expect(edge.sync).toMatchObject({
      storeId: '11111111-1111-4111-8111-111111111111',
      targetUrl: 'https://pos.example.test/api/sync/events',
      pollSeconds: 30,
    });
  });

  it('rejects incomplete or unsafe synchronization settings', () => {
    expect(() =>
      parseEnvironment({ ...base, PAYGO_SYNC_ENABLED: 'yes' }),
    ).toThrow('PAYGO_SYNC_ENABLED');
    expect(() =>
      parseEnvironment({ ...base, PAYGO_SYNC_ENABLED: 'true' }),
    ).toThrow('PAYGO_SYNC_SECRET');
    expect(() =>
      parseEnvironment({
        ...base,
        PAYGO_SYNC_ENABLED: 'true',
        PAYGO_SYNC_SECRET: 's'.repeat(32),
        PAYGO_SYNC_STORE_ID: 'not-a-store',
      }),
    ).toThrow('PAYGO_SYNC_STORE_ID');
    expect(() =>
      parseEnvironment({
        ...base,
        PAYGO_RUNTIME_MODE: 'edge',
        PAYGO_STORE_ID: '11111111-1111-4111-8111-111111111111',
        PAYGO_SYNC_ENABLED: 'true',
        PAYGO_SYNC_SECRET: 's'.repeat(32),
        PAYGO_SYNC_URL: 'http://pos.example.test/api/sync/events',
      }),
    ).toThrow('HTTPS');
  });
});
