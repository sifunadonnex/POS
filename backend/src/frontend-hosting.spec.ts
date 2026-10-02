import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { configureFrontendHosting } from './frontend-hosting.js';

describe('frontend hosting', () => {
  let directory: string | undefined;
  let app: NestExpressApplication | undefined;

  afterEach(async () => {
    await app?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    app = undefined;
    directory = undefined;
  });

  it('leaves the API-only application unchanged without a frontend build', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pay-and-go-empty-public-'));
    const useStaticAssets = vi.fn();
    const application = {
      useStaticAssets,
    } as unknown as NestExpressApplication;

    expect(configureFrontendHosting(application, directory)).toBe(false);
    expect(useStaticAssets).not.toHaveBeenCalled();
  });

  it('serves the built entrypoint and immutable hashed assets', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pay-and-go-public-'));
    await mkdir(join(directory, 'assets'));
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><title>Pay & Go</title>',
    );
    await writeFile(join(directory, 'assets', 'app-abc123.js'), 'export {};');
    const module = await Test.createTestingModule({}).compile();
    app = module.createNestApplication<NestExpressApplication>();

    expect(configureFrontendHosting(app, directory)).toBe(true);
    await app.init();

    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect(/Pay & Go/);
    await request(app.getHttpServer())
      .get('/assets/app-abc123.js')
      .expect(200)
      .expect('Cache-Control', 'public, max-age=31536000, immutable');
    await request(app.getHttpServer()).get('/api/not-a-route').expect(404);
  });
});
