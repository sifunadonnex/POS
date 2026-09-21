import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ReturnsController } from './returns.controller.js';
import { ReturnsService } from './returns.service.js';
import { ReturnsWrites } from './returns-writes.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ReturnsController],
  providers: [ReturnsService, ReturnsWrites],
  exports: [ReturnsService],
})
export class ReturnsModule {}
