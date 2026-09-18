import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ShiftsController } from './shifts.controller.js';
import { ShiftsService } from './shifts.service.js';
import { ShiftsWrites } from './shifts-writes.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ShiftsController],
  providers: [ShiftsService, ShiftsWrites],
  exports: [ShiftsService],
})
export class ShiftsModule {}
