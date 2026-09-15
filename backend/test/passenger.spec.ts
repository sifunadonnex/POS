import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const directories: string[] = [];

async function fixture(source: string) {
  const dir = await mkdtemp(join(tmpdir(), 'pay-and-go-passenger-'));
  directories.push(dir);
  await mkdir(join(dir, 'dist'));
  await copyFile(new URL('../app.cjs', import.meta.url), join(dir, 'app.cjs'));
  await writeFile(join(dir, 'package.json'), '{"type":"module"}');
  await writeFile(join(dir, 'dist/main.js'), source);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

it('loads an ESM entrypoint with top-level await from another working directory', async () => {
  const dir = await fixture(
    'await Promise.resolve(); console.log(process.cwd());',
  );
  const result = await execute(process.execPath, [join(dir, 'app.cjs')], {
    cwd: tmpdir(),
    timeout: 5000,
  });
  expect(result.stdout.trim()).toBe(dir);
  expect(result.stderr).toBe('');
});

it('exits unsuccessfully without exposing an import error containing secrets', async () => {
  const dir = await fixture("throw new Error('password=do-not-log');");
  await expect(
    execute(process.execPath, [join(dir, 'app.cjs')], { timeout: 5000 }),
  ).rejects.toMatchObject({
    code: 1,
    stdout: '',
    stderr:
      'Pay & Go failed to start. Check runtime dependencies and server configuration.\n',
  });
});
