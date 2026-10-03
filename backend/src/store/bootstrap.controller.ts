import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { EdgeBootstrapService } from './edge-bootstrap.service.js';
import { HostedBootstrapService } from './hosted-bootstrap.service.js';

@Controller('api/bootstrap')
@StaffRoles('manager')
export class BootstrapController {
  constructor(
    @Inject(HostedBootstrapService)
    private readonly hosted: HostedBootstrapService,
    @Inject(EdgeBootstrapService) private readonly edge: EdgeBootstrapService,
  ) {}

  @Post('publications')
  publish(@Req() req: StaffRequest) {
    return this.hosted.publish({
      userId: req.staff.user.id,
      sessionId: req.staff.session.id,
    });
  }

  @Post('opening-stock')
  signOffOpening(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.edge.signOffOpening(
      { userId: req.staff.user.id, sessionId: req.staff.session.id },
      body,
    );
  }
}
