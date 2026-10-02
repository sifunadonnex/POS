import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';

export function configureFrontendHosting(
  app: NestExpressApplication,
  frontendDirectory = join(process.cwd(), 'public'),
): boolean {
  if (!existsSync(join(frontendDirectory, 'index.html'))) return false;

  const assetsSegment = `${sep}assets${sep}`;
  app.useStaticAssets(frontendDirectory, {
    index: 'index.html',
    setHeaders(response, filePath) {
      if (filePath.endsWith(`${sep}index.html`)) {
        response.setHeader('Cache-Control', 'no-store');
      } else if (filePath.includes(assetsSegment)) {
        response.setHeader(
          'Cache-Control',
          'public, max-age=31536000, immutable',
        );
      } else {
        response.setHeader('Cache-Control', 'no-cache');
      }
    },
  });
  return true;
}
