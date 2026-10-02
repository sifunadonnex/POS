import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseAuthEnvironment } from '../identity/auth.config.js';
import { loadLocalEnvironment, parseEnvironment } from './environment.js';

type ReadableFileCheck = (path: string, mode: number) => Promise<void>;

export async function validateHostingConfiguration(
  env: NodeJS.ProcessEnv,
  checkReadableFile: ReadableFileCheck = access,
): Promise<void> {
  const appConfig = parseEnvironment(env);
  parseAuthEnvironment(env);

  const databaseHost = new URL(appConfig.databaseUrl).hostname.toLowerCase();
  if (!databaseHost.endsWith('.aivencloud.com')) return;

  const caPath = env.NODE_EXTRA_CA_CERTS?.trim();
  if (!caPath) {
    throw new Error(
      'NODE_EXTRA_CA_CERTS is required for the Aiven database connection',
    );
  }
  try {
    await checkReadableFile(caPath, constants.R_OK);
  } catch {
    throw new Error(
      'NODE_EXTRA_CA_CERTS must point to a readable Aiven CA certificate',
    );
  }
}

async function run(): Promise<void> {
  loadLocalEnvironment();
  await validateHostingConfiguration(process.env);
  console.log(
    'Hosted configuration validated: database, TLS and authentication settings are present.',
  );
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  try {
    await run();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown configuration error';
    console.error(`Hosted configuration invalid: ${message}`);
    process.exitCode = 1;
  }
}
