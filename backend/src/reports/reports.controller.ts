import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { ReportsService } from './reports.service.js';

@Controller('api/reports')
export class ReportsController {
  constructor(
    @Inject(ReportsService) private readonly reports: ReportsService,
  ) {}

  @Get('summary/:day')
  @StaffRoles('manager')
  summary(@Req() _req: StaffRequest, @Param('day') day: string) {
    return this.reports.summary(day);
  }
}
