import { loadEnvFile } from 'node:process';

export const APP_CONFIG = Symbol('APP_CONFIG');

export type RuntimeMode = 'hosted' | 'edge';

export function loadLocalEnvironment(): void {
  try {
    loadEnvFile();
  } catch (error) {
    if (!(
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    )) {
      throw new Error('Unable to load backend .env file');
    }
  }
}

function integer(
  value: string | undefined,
  fallback: number,
  max: number,
  name: string,
): number {
  const input = value ?? String(fallback);
  const result = Number(input);
  if (
    !/^\d+$/.test(input) ||
    !Number.isSafeInteger(result) ||
    result < 1 ||
    result > max
  ) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return result;
}

function enabled(value: string | undefined, name: string): boolean {
  const input = value ?? 'false';
  if (input !== 'true' && input !== 'false') {
    throw new Error(`${name} must be true or false`);
  }
  return input === 'true';
}

function required(
  value: string | undefined,
  name: string,
  minimum: number,
  maximum: number,
): string {
  const result = value?.trim() ?? '';
  if (result.length < minimum || result.length > maximum) {
    throw new Error(`${name} is required when DARAJA_ENABLED is true`);
  }
  return result;
}

function darajaConfiguration(env: NodeJS.ProcessEnv) {
  if (!enabled(env.DARAJA_ENABLED, 'DARAJA_ENABLED')) return null;
  const environment = env.DARAJA_ENVIRONMENT ?? 'sandbox';
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('DARAJA_ENVIRONMENT must be sandbox or production');
  }
  const transactionType =
    env.DARAJA_TRANSACTION_TYPE ?? 'CustomerPayBillOnline';
  if (
    transactionType !== 'CustomerPayBillOnline' &&
    transactionType !== 'CustomerBuyGoodsOnline'
  ) {
    throw new Error(
      'DARAJA_TRANSACTION_TYPE must be CustomerPayBillOnline or CustomerBuyGoodsOnline',
    );
  }
  const shortCode = required(env.DARAJA_SHORTCODE, 'DARAJA_SHORTCODE', 5, 12);
  if (!/^\d+$/.test(shortCode)) {
    throw new Error('DARAJA_SHORTCODE must contain only digits');
  }
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(
      required(env.DARAJA_CALLBACK_URL, 'DARAJA_CALLBACK_URL', 12, 500),
    );
    if (
      callbackUrl.protocol !== 'https:' ||
      callbackUrl.username ||
      callbackUrl.password ||
      callbackUrl.search ||
      callbackUrl.hash
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      'DARAJA_CALLBACK_URL must be an HTTPS URL without credentials, query parameters or fragments',
    );
  }
  return {
    environment,
    consumerKey: required(
      env.DARAJA_CONSUMER_KEY,
      'DARAJA_CONSUMER_KEY',
      8,
      200,
    ),
    consumerSecret: required(
      env.DARAJA_CONSUMER_SECRET,
      'DARAJA_CONSUMER_SECRET',
      8,
      200,
    ),
    shortCode,
    passkey: required(env.DARAJA_PASSKEY, 'DARAJA_PASSKEY', 16, 500),
    transactionType,
    callbackUrl: callbackUrl.toString(),
    callbackToken: required(
      env.DARAJA_CALLBACK_TOKEN,
      'DARAJA_CALLBACK_TOKEN',
      32,
      200,
    ),
  } as const;
}

function runtimeConfiguration(env: NodeJS.ProcessEnv) {
  const mode = env.PAYGO_RUNTIME_MODE ?? 'hosted';
  if (mode !== 'hosted' && mode !== 'edge') {
    throw new Error('PAYGO_RUNTIME_MODE must be hosted or edge');
  }
  const storeId = env.PAYGO_STORE_ID?.trim() ?? '';
  if (
    mode === 'edge' &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      storeId,
    )
  ) {
    throw new Error('PAYGO_STORE_ID must be a UUID when edge mode is enabled');
  }
  return {
    mode: mode as RuntimeMode,
    storeId: mode === 'edge' ? storeId : null,
  } as const;
}

function uuid(value: string | undefined, name: string): string {
  const result = value?.trim() ?? '';
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result,
    )
  ) {
    throw new Error(`${name} must be a UUID when synchronization is enabled`);
  }
  return result;
}

function syncConfiguration(
  env: NodeJS.ProcessEnv,
  runtime: ReturnType<typeof runtimeConfiguration>,
) {
  if (!enabled(env.PAYGO_SYNC_ENABLED, 'PAYGO_SYNC_ENABLED')) return null;
  const secret = env.PAYGO_SYNC_SECRET?.trim() ?? '';
  if (secret.length < 32 || secret.length > 500) {
    throw new Error(
      'PAYGO_SYNC_SECRET must contain between 32 and 500 characters when synchronization is enabled',
    );
  }
  const storeId =
    runtime.mode === 'edge'
      ? runtime.storeId
      : uuid(env.PAYGO_SYNC_STORE_ID, 'PAYGO_SYNC_STORE_ID');
  let targetUrl: string | null = null;
  if (runtime.mode === 'edge') {
    try {
      const url = new URL(env.PAYGO_SYNC_URL ?? '');
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/api/sync/events'
      ) {
        throw new Error();
      }
      targetUrl = url.toString();
    } catch {
      throw new Error(
        'PAYGO_SYNC_URL must be the HTTPS /api/sync/events endpoint without credentials, query parameters or fragments',
      );
    }
  }
  return {
    storeId: storeId as string,
    secret,
    targetUrl,
    pollSeconds: integer(
      env.PAYGO_SYNC_POLL_SECONDS,
      10,
      300,
      'PAYGO_SYNC_POLL_SECONDS',
    ),
  } as const;
}

function bootstrapConfiguration(env: NodeJS.ProcessEnv) {
  const secret = env.PAYGO_BOOTSTRAP_SECRET?.trim();
  if (!secret) return null;
  if (
    secret.length < 32 ||
    secret.length > 500 ||
    secret === env.PAYGO_SYNC_SECRET ||
    secret === env.BETTER_AUTH_SECRET ||
    /replace|example|change.me/i.test(secret)
  ) {
    throw new Error(
      'PAYGO_BOOTSTRAP_SECRET must be a separate random secret of 32-500 characters',
    );
  }
  return { secret };
}

export function parseEnvironment(env: NodeJS.ProcessEnv) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test or production');
  }
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? '');
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      url.pathname.length < 2 ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      'DATABASE_URL must be a PostgreSQL URL with host, user and database, without query parameters or fragments',
    );
  }
  const tls = env.DATABASE_TLS ?? 'verify';
  if (!['verify', 'disable'].includes(tls)) {
    throw new Error('DATABASE_TLS must be verify or disable');
  }
  if (
    tls === 'disable' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error(
      'DATABASE_TLS may only be disabled for a loopback database host',
    );
  }
  const runtime = runtimeConfiguration(env);
  const daraja = darajaConfiguration(env);
  if (runtime.mode === 'edge' && daraja) {
    throw new Error(
      'DARAJA_ENABLED must remain false in edge mode until online payment handoff is implemented',
    );
  }
  const sync = syncConfiguration(env, runtime);
  const bootstrap = bootstrapConfiguration(env);
  return {
    nodeEnv,
    port: integer(env.PORT, 3000, 65535, 'PORT'),
    databaseUrl: url.toString(),
    databaseTls: tls === 'verify',
    databasePoolMax: integer(env.DATABASE_POOL_MAX, 5, 20, 'DATABASE_POOL_MAX'),
    runtime,
    daraja,
    sync,
    bootstrap,
  };
}

export type AppConfig = ReturnType<typeof parseEnvironment>;
