import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { ShiftsService } from './shifts.service.js';

function actor(req: StaffRequest) {
  return { userId: req.staff.user.id, sessionId: req.staff.session.id };
}

@Controller('api/shifts')
export class ShiftsController {
  constructor(
    @Inject(ShiftsService) private readonly shifts: ShiftsService,
  ) {}

  @Post('open')
  @StaffRoles('cashier', 'manager')
  open(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.shifts.openShift(actor(req), body);
  }

  @Post(':shiftId/close')
  @StaffRoles('cashier', 'manager')
  close(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.shifts.closeShift(actor(req), {
      ...(body && typeof body === 'object' ? (body as Record<string, unknown>) : {}),
      shiftId: (req.params as Record<string, string>).shiftId,
    });
  }
}
