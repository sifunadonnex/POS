import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '../config/config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { StoreAuthorityGuard } from './store-authority.guard.js';
import { StoreAuthorityService } from './store-authority.service.js';
import { BootstrapController } from './bootstrap.controller.js';
import { EdgeBootstrapService } from './edge-bootstrap.service.js';
import { HostedBootstrapService } from './hosted-bootstrap.service.js';
import { HostedConfigurationService } from './hosted-configuration.service.js';
import { EdgeConfigurationService } from './edge-configuration.service.js';
import { HostedCutoverService } from './hosted-cutover.service.js';

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [
    StoreAuthorityService,
    EdgeBootstrapService,
    HostedBootstrapService,
    HostedConfigurationService,
    EdgeConfigurationService,
    HostedCutoverService,
    { provide: APP_GUARD, useClass: StoreAuthorityGuard },
  ],
  controllers: [BootstrapController],
  exports: [StoreAuthorityService],
})
export class StoreAuthorityModule {}
