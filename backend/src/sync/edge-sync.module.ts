import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { EdgeSyncController } from './edge-sync.controller.js';
import { EdgeSyncService } from './edge-sync.service.js';
import { HostedSyncService } from './hosted-sync.service.js';
import {
  EdgeSyncWorker,
  SYNC_FETCH,
  type SyncFetch,
} from './edge-sync.worker.js';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [EdgeSyncController],
  providers: [
    EdgeSyncService,
    HostedSyncService,
    EdgeSyncWorker,
    {
      provide: SYNC_FETCH,
      useFactory: (): SyncFetch => globalThis.fetch.bind(globalThis),
    },
  ],
  exports: [EdgeSyncService],
})
export class EdgeSyncModule {}
