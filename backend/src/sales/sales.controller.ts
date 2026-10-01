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
import { SalesLookupService } from './sales-lookup.service.js';
import { SalesService } from './sales.service.js';
import { SuspendedOrdersService } from './suspended-orders.service.js';

function actor(req: StaffRequest) {
  return { userId: req.staff.user.id, sessionId: req.staff.session.id };
}

function lookupActor(req: StaffRequest) {
  return {
    userId: req.staff.user.id,
    role: req.staff.user.role === 'manager' ? 'manager' : 'cashier',
  } as const;
}

@Controller('api/sales')
export class SalesController {
  constructor(
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(SalesLookupService) private readonly lookup: SalesLookupService,
    @Inject(SuspendedOrdersService)
    private readonly suspendedOrders: SuspendedOrdersService,
  ) {}

  @Get('held-orders')
  @StaffRoles('cashier', 'manager')
  heldOrders(@Req() req: StaffRequest) {
    return this.suspendedOrders.list({ ...actor(req), ...lookupActor(req) });
  }

  @Post('held-orders')
  @StaffRoles('cashier', 'manager')
  holdOrder(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.suspendedOrders.create(
      { ...actor(req), ...lookupActor(req) },
      body,
    );
  }

  @Post('held-orders/:id/resume')
  @StaffRoles('cashier', 'manager')
  resumeHeldOrder(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.suspendedOrders.resume(
      { ...actor(req), ...lookupActor(req) },
      id,
      body,
    );
  }

  @Post('held-orders/:id/cancel')
  @StaffRoles('cashier', 'manager')
  cancelHeldOrder(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.suspendedOrders.cancel(
      { ...actor(req), ...lookupActor(req) },
      id,
      body,
    );
  }

  @Get()
  @StaffRoles('cashier', 'manager')
  list(
    @Req() req: StaffRequest,
    @Query('search') search: unknown,
    @Query('from') from: unknown,
    @Query('to') to: unknown,
    @Query('page') page: unknown,
  ) {
    return this.lookup.listSales(lookupActor(req), search, from, to, page);
  }

  @Get(':saleId')
  @StaffRoles('cashier', 'manager')
  detail(@Req() req: StaffRequest, @Param('saleId') saleId: string) {
    return this.lookup.detail(lookupActor(req), saleId);
  }

  @Get(':saleId/receipt')
  @StaffRoles('cashier', 'manager')
  receipt(@Param('saleId') saleId: string) {
    return this.lookup.receipt(saleId);
  }

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

  @Post('checkout')
  @StaffRoles('cashier', 'manager')
  checkout(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.sales.checkout(actor(req), body);
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
