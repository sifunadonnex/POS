import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CatalogueController } from './catalogue.controller.js';
import { CatalogueService } from './catalogue.service.js';
import { CatalogueWrites } from './catalogue-writes.js';
import { CatalogueImportService } from './catalogue-import.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [CatalogueController],
  providers: [CatalogueService, CatalogueWrites, CatalogueImportService],
})
export class CatalogueModule {}
