import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { SalesService } from './sales.service.js';

function actor(req: StaffRequest) {
  return { userId: req.staff.user.id, sessionId: req.staff.session.id };
}

@Controller('api/sales')
export class SalesController {
  constructor(@Inject(SalesService) private readonly sales: SalesService) {}

  @Post('quote')
  @StaffRoles('cashier', 'manager')
  quote(@Body() body: unknown) {
    const lines = Array.isArray(body)
      ? body
      : body &&
          typeof body === 'object' &&
          Array.isArray((body as Record<string, unknown>).lines)
        ? (body as Record<string, unknown>).lines
        : undefined;

    return this.sales.quoteCurrentBasket(lines);
  }

  @Post()
  @StaffRoles('cashier', 'manager')
  finalize(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.sales.finalize(actor(req), body);
  }

  @Post(':saleId/payments')
  @StaffRoles('cashier', 'manager')
  recordPayment(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.sales.recordPayment(actor(req), {
      ...(body && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {}),
      saleId: (req.params as Record<string, string>).saleId,
    });
  }
}
