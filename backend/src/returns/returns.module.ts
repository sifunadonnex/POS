import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ReturnsController } from './returns.controller.js';
import { ReturnsService } from './returns.service.js';
import { ReturnsWrites } from './returns-writes.js';
import { ReturnsLookupService } from './returns-lookup.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ReturnsController],
  providers: [ReturnsService, ReturnsWrites, ReturnsLookupService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
