import { ShiftsService } from '../shifts/shifts.service.js';
import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { StoreWrites } from '../store/store-write.metadata.js';
import { BusinessService } from './business.service.js';

@Controller('api/business')
@StoreWrites('central')
export class BusinessController {
  constructor(
    @Inject(BusinessService) private readonly business: BusinessService,
    @Inject(ShiftsService) private readonly shifts: ShiftsService,
  ) {}
  @Get() configuration(@Req() req: StaffRequest) {
    return this.business.configuration(req);
  }
  @Get('administration') @StaffRoles('manager') administration() {
    return this.business.administration();
  }
  @Post('branches') @StaffRoles('manager') branch(
    @Req() req: StaffRequest,
    @Body() body: unknown,
  ) {
    return this.business.createBranch(req, body);
  }
  @Post('settings') @StaffRoles('manager') settings(
    @Req() req: StaffRequest,
    @Body() body: unknown,
  ) {
    return this.business.saveSettings(req, body);
  }
  @Post('staff-access') @StaffRoles('manager') access(
    @Req() req: StaffRequest,
    @Body() body: unknown,
  ) {
    return this.business.assignStaff(req, body);
  }
  @Post('close-shift')
  @StaffRoles('manager')
  @StoreWrites('operational')
  closeShift(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.shifts.closeShift(
      {
        userId: req.staff.user.id,
        sessionId: req.staff.session.id,
        role: 'manager',
      },
      body,
    );
  }
  @Post('assign-product') @StaffRoles('manager') product(
    @Req() req: StaffRequest,
    @Body() body: unknown,
  ) {
    return this.business.assignProduct(req, body);
  }
}
