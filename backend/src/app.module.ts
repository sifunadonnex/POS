import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { IdentityModule } from './identity/identity.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { PurchasesModule } from './purchases/purchases.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { ReturnsModule } from './returns/returns.module.js';
import { SalesModule } from './sales/sales.module.js';
import { ShiftsModule } from './shifts/shifts.module.js';
import { StocktakeModule } from './stocktake/stocktake.module.js';

@Module({
  imports: [ConfigModule, DatabaseModule, IdentityModule, CatalogueModule, InventoryModule, SalesModule, ReturnsModule, ShiftsModule, ReportsModule, StocktakeModule, PurchasesModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
