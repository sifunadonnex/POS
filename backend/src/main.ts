import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import {
  APP_CONFIG,
  loadLocalEnvironment,
  type AppConfig,
} from './config/environment.js';
import { configureFrontendHosting } from './frontend-hosting.js';

async function bootstrap() {
  loadLocalEnvironment();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  configureFrontendHosting(app);
  app.enableShutdownHooks();
  if (config.runtime.mode === 'edge') {
    await app.listen(config.port, '127.0.0.1');
  } else {
    await app.listen(config.port);
  }
}
await bootstrap();
