import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { ReturnsService } from './returns.service.js';
import { ReturnsLookupService } from './returns-lookup.service.js';

function actor(req: StaffRequest) {
  return { userId: req.staff.user.id, sessionId: req.staff.session.id };
}

@Controller('api/returns')
export class ReturnsController {
  constructor(
    @Inject(ReturnsService) private readonly returns: ReturnsService,
    @Inject(ReturnsLookupService) private readonly lookup: ReturnsLookupService,
  ) {}

  @Get('sales')
  @StaffRoles('cashier', 'manager')
  sales(@Query('search') search: unknown, @Query('page') page: unknown) {
    return this.lookup.listSales(search, page);
  }

  @Get('sales/:saleId')
  @StaffRoles('cashier', 'manager')
  sale(@Param('saleId') saleId: string) {
    return this.lookup.sale(saleId);
  }

  @Post()
  @StaffRoles('cashier', 'manager')
  create(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.returns.createReturn(actor(req), body);
  }
}
