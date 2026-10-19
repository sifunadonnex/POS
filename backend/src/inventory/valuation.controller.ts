import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { StoreWrites } from '../store/store-write.metadata.js';
import { ValuationService } from './valuation.service.js';

@Controller('api/inventory/valuation')
@StaffRoles('manager')
@StoreWrites('operational')
export class ValuationController {
  constructor(
    @Inject(ValuationService) private readonly valuation: ValuationService,
  ) {}
  @Get() position(@Query('day') day: string) {
    return this.valuation.position(day);
  }
  @Post('opening') opening(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.valuation.opening(
      { userId: req.staff.user.id, sessionId: req.staff.session.id },
      body,
    );
  }
}
