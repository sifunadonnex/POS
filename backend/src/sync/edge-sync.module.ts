import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { EdgeSyncController } from './edge-sync.controller.js';
import { EdgeSyncService } from './edge-sync.service.js';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [EdgeSyncController],
  providers: [EdgeSyncService],
  exports: [EdgeSyncService],
})
export class EdgeSyncModule {}
