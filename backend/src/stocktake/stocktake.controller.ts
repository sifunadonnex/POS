import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { StoreWrites } from '../store/store-write.metadata.js';
import { StocktakeService } from './stocktake.service.js';

function actor(req: StaffRequest) {
  return { userId: req.staff.user.id, sessionId: req.staff.session.id };
}

@Controller('api/stocktake')
@StoreWrites('operational')
export class StocktakeController {
  constructor(
    @Inject(StocktakeService) private readonly stocktake: StocktakeService,
  ) {}

  @Post()
  @StaffRoles('manager', 'cashier')
  count(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.stocktake.count(actor(req), body);
  }
}
