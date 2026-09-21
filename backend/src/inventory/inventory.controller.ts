import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { InventoryService } from './inventory.service.js';

@Controller('api/inventory')
export class InventoryController {
  constructor(
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  @Get('stock')
  @StaffRoles('manager')
  stock(@Query('search') search: unknown, @Query('page') page: unknown) {
    return this.inventory.stock(search, page);
  }

  @Get('stock/:productId/history')
  @StaffRoles('manager')
  history(@Param('productId') productId: string, @Query('page') page: unknown) {
    return this.inventory.history(productId, page);
  }

  @Post('opening')
  @StaffRoles('manager')
  opening(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.inventory.opening({ userId: req.staff.user.id, sessionId: req.staff.session.id }, body);
  }

  @Post('receive')
  @StaffRoles('manager')
  receive(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.inventory.receive({ userId: req.staff.user.id, sessionId: req.staff.session.id }, body);
  }

  @Post('adjust')
  @StaffRoles('manager')
  adjust(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.inventory.adjust({ userId: req.staff.user.id, sessionId: req.staff.session.id }, body);
  }
}
