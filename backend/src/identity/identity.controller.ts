import { Controller, Get, Req } from '@nestjs/common';
import type { StaffRequest } from './staff.guard.js';
import { StaffRoles } from './access.metadata.js';

@Controller('api/identity')
export class IdentityController {
  @Get('me')
  me(@Req() req: StaffRequest) {
    const { id, name, email, role } = req.staff.user;
    return { user: { id, name, email, role } };
  }

  @Get('manager-access')
  @StaffRoles('manager')
  managerAccess() {
    return { role: 'manager' };
  }
}
