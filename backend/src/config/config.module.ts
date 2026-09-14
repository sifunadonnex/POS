import { Module } from '@nestjs/common';
import { APP_CONFIG, parseEnvironment } from './environment.js';

@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => parseEnvironment(process.env) },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
