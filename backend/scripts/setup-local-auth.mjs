import { randomBytes } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

// Local setup utility: preserves every existing value and never prints secrets.
try {
  const file = new URL('../.env', import.meta.url);
  const existing = parseEnv(await readFile(file, 'utf8'));
  const database = new URL(existing.DATABASE_URL ?? '');
  if (
    existing.NODE_ENV === 'production' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) ||
    !database.pathname.endsWith('_dev')
  ) {
    throw new Error('Not a local development configuration');
  }
  const additions = [];
  if (!Object.hasOwn(existing, 'BETTER_AUTH_SECRET'))
    additions.push(`BETTER_AUTH_SECRET=${randomBytes(32).toString('hex')}`);
  if (!Object.hasOwn(existing, 'BETTER_AUTH_URL'))
    additions.push('BETTER_AUTH_URL=http://localhost:5173');
  if (additions.length) await appendFile(file, `\n${additions.join('\n')}\n`);
  console.log(
    'Local auth configuration checked. Existing values preserved; no secrets printed.',
  );
} catch {
  console.error(
    'Local auth setup failed. Configure backend/.env for a loopback _dev database first.',
  );
  process.exitCode = 1;
}
