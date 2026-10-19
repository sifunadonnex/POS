import { ShiftsModule } from '../shifts/shifts.module.js';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module.js';
import { BusinessController } from './business.controller.js';
import { BusinessService } from './business.service.js';
import { BusinessInterceptor } from './business.interceptor.js';

@Module({
  imports: [DatabaseModule, ShiftsModule],
  controllers: [BusinessController],
  providers: [
    BusinessService,
    { provide: APP_INTERCEPTOR, useClass: BusinessInterceptor },
  ],
})
export class BusinessModule {}
