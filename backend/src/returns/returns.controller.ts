import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { ReturnsService } from './returns.service.js';

function actor(req: StaffRequest) {
  return { userId: req.staff.user.id, sessionId: req.staff.session.id };
}

@Controller('api/returns')
export class ReturnsController {
  constructor(
    @Inject(ReturnsService) private readonly returns: ReturnsService,
  ) {}

  @Post()
  @StaffRoles('cashier', 'manager')
  create(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.returns.createReturn(actor(req), body);
  }
}
