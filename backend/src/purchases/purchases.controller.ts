import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { PurchasesService } from './purchases.service.js';

function actor(req: StaffRequest) {
  return { userId: req.staff.user.id, sessionId: req.staff.session.id };
}

@Controller('api/purchases')
export class PurchasesController {
  constructor(
    @Inject(PurchasesService) private readonly purchases: PurchasesService,
  ) {}

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
