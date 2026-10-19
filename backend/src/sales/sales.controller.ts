import { RegisterBasketService } from './register-basket.service.js';
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
import { StoreWrites } from '../store/store-write.metadata.js';
import { SalesLookupService } from './sales-lookup.service.js';
import { SalesService } from './sales.service.js';
import { SuspendedOrdersService } from './suspended-orders.service.js';

function actor(req: StaffRequest) {
  return { userId: req.staff.user.id, sessionId: req.staff.session.id };
}

function lookupActor(req: StaffRequest) {
  return {
    userId: req.staff.user.id,
    role:
      req.staff.user.role === 'manager'
        ? 'manager'
        : req.staff.user.role === 'supervisor'
          ? 'supervisor'
          : 'cashier',
  } as const;
}

@Controller('api/sales')
@StoreWrites('operational')
export class SalesController {
  constructor(
    @Inject(RegisterBasketService)
    private readonly basket: RegisterBasketService,
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(SalesLookupService) private readonly lookup: SalesLookupService,
    @Inject(SuspendedOrdersService)
    private readonly suspendedOrders: SuspendedOrdersService,
  ) {}

  @Get('basket')
  @StaffRoles('cashier', 'supervisor', 'manager')
  basketRead(@Req() req: StaffRequest) {
    return this.basket.read(actor(req));
  }

  @Post('basket')
  @StaffRoles('cashier', 'supervisor', 'manager')
  basketSave(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.basket.save(actor(req), body);
  }

  @Get('held-orders')
  @StaffRoles('cashier', 'supervisor', 'manager')
  heldOrders(@Req() req: StaffRequest) {
    return this.suspendedOrders.list({ ...actor(req), ...lookupActor(req) });
  }

  @Post('held-orders')
  @StaffRoles('cashier', 'supervisor', 'manager')
  holdOrder(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.suspendedOrders.create(
      { ...actor(req), ...lookupActor(req) },
      body,
    );
  }

  @Post('held-orders/:id/resume')
  @StaffRoles('cashier', 'supervisor', 'manager')
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
  @StaffRoles('cashier', 'supervisor', 'manager')
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
  @StaffRoles('cashier', 'supervisor', 'manager')
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
  @StaffRoles('cashier', 'supervisor', 'manager')
  detail(@Req() req: StaffRequest, @Param('saleId') saleId: string) {
    return this.lookup.detail(lookupActor(req), saleId);
  }

  @Get(':saleId/receipt')
  @StaffRoles('cashier', 'supervisor', 'manager')
  receipt(@Param('saleId') saleId: string) {
    return this.lookup.receipt(saleId);
  }

  @Post('quote')
  @StaffRoles('cashier', 'supervisor', 'manager')
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
  @StaffRoles('cashier', 'supervisor', 'manager')
  finalize(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.sales.finalize(actor(req), body);
  }

  @Post('checkout')
  @StaffRoles('cashier', 'supervisor', 'manager')
  checkout(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.sales.checkout(actor(req), body);
  }

  @Post(':saleId/payments')
  @StaffRoles('cashier', 'supervisor', 'manager')
  recordPayment(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.sales.recordPayment(actor(req), {
      ...(body && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {}),
      saleId: (req.params as Record<string, string>).saleId,
    });
  }
}
