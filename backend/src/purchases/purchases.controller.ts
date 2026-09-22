import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { PurchasesService } from './purchases.service.js';
import { SuppliersService } from './suppliers.service.js';

function actor(req: StaffRequest) {
  return { userId: req.staff.user.id, sessionId: req.staff.session.id };
}

@Controller('api/purchases')
export class PurchasesController {
  constructor(
    @Inject(PurchasesService) private readonly purchases: PurchasesService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
  ) {}

  @Get('suppliers')
  @StaffRoles('manager')
  suppliersList(
    @Query('search') search: unknown,
    @Query('page') page: unknown,
  ) {
    return this.suppliers.list(search, page);
  }

  @Post('suppliers')
  @StaffRoles('manager')
  createSupplier(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.suppliers.create(actor(req), body);
  }

  @Get('suppliers/:supplierId/ledger')
  @StaffRoles('manager')
  supplierLedger(
    @Param('supplierId') supplierId: string,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
    @Query('page') page: unknown,
  ) {
    return this.suppliers.ledger(supplierId, from, to, page);
  }

  @Post('receive')
  @StaffRoles('manager', 'cashier')
  receive(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.purchases.receive(actor(req), body);
  }

  @Post('return')
  @StaffRoles('manager', 'cashier')
  returnReceipt(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.purchases.returnReceipt(actor(req), body);
  }
}
