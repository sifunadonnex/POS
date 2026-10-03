import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '../config/config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { StoreAuthorityGuard } from './store-authority.guard.js';
import { StoreAuthorityService } from './store-authority.service.js';

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [
    StoreAuthorityService,
    { provide: APP_GUARD, useClass: StoreAuthorityGuard },
  ],
  exports: [StoreAuthorityService],
})
export class StoreAuthorityModule {}
