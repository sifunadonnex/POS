import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { StaffRoles } from './access.metadata.js';
import { StaffAdminService } from './staff-admin.service.js';
import type { StaffRequest } from './staff.guard.js';

@Controller('api/identity')
@StaffRoles('manager')
export class StaffAdminController {
  constructor(
    @Inject(StaffAdminService) private readonly staff: StaffAdminService,
  ) {}

  @Get('staff')
  list(@Query('search') search: unknown, @Query('page') page: unknown) {
    return this.staff.list(search, page);
  }

  @Post('staff')
  create(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.staff.create(req, body);
  }

  @Patch('staff/:id')
  update(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.staff.update(req, id, body);
  }

  @Post('staff/:id/:action')
  action(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() body: unknown,
  ) {
    return this.staff.action(req, id, action, body);
  }

  @Get('audit')
  audit(@Query('before') before: unknown) {
    return this.staff.auditLog(before);
  }
}
