import { loadEnvFile } from 'node:process';

export const APP_CONFIG = Symbol('APP_CONFIG');

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
  return {
    nodeEnv,
    port: integer(env.PORT, 3000, 65535, 'PORT'),
    databaseUrl: url.toString(),
    databaseTls: tls === 'verify',
    databasePoolMax: integer(env.DATABASE_POOL_MAX, 5, 20, 'DATABASE_POOL_MAX'),
  };
}

export type AppConfig = ReturnType<typeof parseEnvironment>;
