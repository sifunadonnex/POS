import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import {
  APP_CONFIG,
  loadLocalEnvironment,
  type AppConfig,
} from './config/environment.js';

async function bootstrap() {
  loadLocalEnvironment();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get<AppConfig>(APP_CONFIG);
  app.enableShutdownHooks();
  await app.listen(config.port);
}
await bootstrap();
