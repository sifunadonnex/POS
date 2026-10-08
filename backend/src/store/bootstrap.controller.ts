import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { EdgeBootstrapService } from './edge-bootstrap.service.js';
import { HostedBootstrapService } from './hosted-bootstrap.service.js';
import { HostedConfigurationService } from './hosted-configuration.service.js';
import { EdgeConfigurationService } from './edge-configuration.service.js';
import { HostedCutoverService } from './hosted-cutover.service.js';
import { EdgeStaffEnrollmentService } from './edge-staff-enrollment.service.js';

@Controller('api/bootstrap')
@StaffRoles('manager')
export class BootstrapController {
  constructor(
    @Inject(HostedBootstrapService)
    private readonly hosted: HostedBootstrapService,
    @Inject(EdgeBootstrapService) private readonly edge: EdgeBootstrapService,
    @Inject(HostedConfigurationService)
    private readonly configuration: HostedConfigurationService,
    @Inject(EdgeConfigurationService)
    private readonly edgeConfiguration: EdgeConfigurationService,
    @Inject(HostedCutoverService)
    private readonly cutover: HostedCutoverService,
    @Inject(EdgeStaffEnrollmentService)
    private readonly staffEnrollment: EdgeStaffEnrollmentService,
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

  @Post('enrollment-grants')
  issueEnrollmentGrant(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.staffEnrollment.issueGrant(
      { userId: req.staff.user.id, sessionId: req.staff.session.id },
      body,
    );
  }

  @Post('changes')
  publishChanges(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.configuration.publishChanges(
      { userId: req.staff.user.id, sessionId: req.staff.session.id },
      body,
    );
  }

  @Get('checkpoint')
  checkpoint() {
    return this.edgeConfiguration.checkpoint();
  }

  @Post('cutover')
  issueCutover(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.cutover.issue(
      { userId: req.staff.user.id, sessionId: req.staff.session.id },
      'cutover',
      body,
    );
  }

  @Post('fence')
  issueFence(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.cutover.issue(
      { userId: req.staff.user.id, sessionId: req.staff.session.id },
      'fence',
      body,
    );
  }
}
