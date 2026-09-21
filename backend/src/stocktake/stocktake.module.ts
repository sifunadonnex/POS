import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { StocktakeController } from './stocktake.controller.js';
import { StocktakeService } from './stocktake.service.js';
import { StocktakeWrites } from './stocktake-writes.js';

@Module({
  imports: [DatabaseModule],
  controllers: [StocktakeController],
  providers: [StocktakeService, StocktakeWrites],
  exports: [StocktakeService],
})
export class StocktakeModule {}
