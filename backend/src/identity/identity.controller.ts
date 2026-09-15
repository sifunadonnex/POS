import {
  Controller,
  Get,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { StaffRequest } from './staff.guard.js';
import { PublicRoute, SecuritySetup, StaffRoles } from './access.metadata.js';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';
import { IDLE_SECONDS, needsMfa } from './security-policy.js';
import { DatabaseService } from '../database/database.service.js';

@Controller('api/identity')
export class IdentityController {
  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  @Get('options')
  @PublicRoute()
  options() {
    return {
      emailDelivery: Boolean(this.config.smtp),
      idleSeconds: IDLE_SECONDS,
    };
  }

  @Get('me')
  @SecuritySetup()
  me(@Req() req: StaffRequest) {
    const { id, name, email, role, emailVerified, twoFactorEnabled } =
      req.staff.user;
    return {
      user: {
        id,
        name,
        email,
        role,
        emailVerified,
        twoFactorEnabled: twoFactorEnabled === true,
        mfaRequired: needsMfa(req.staff),
        idleSeconds: IDLE_SECONDS,
      },
    };
  }

  @Post('activity')
  @SecuritySetup()
  async activity(@Req() req: StaffRequest) {
    let count: number | null;
    try {
      const result = await this.database.connectionPool.query(
        'UPDATE session SET "lastActivityAt" = now() WHERE id = $1 AND "lastActivityAt" > now() - ($2 * interval \'1 second\') RETURNING id',
        [req.staff.session.id, IDLE_SECONDS],
      );
      count = result.rowCount;
    } catch {
      throw new ServiceUnavailableException(
        'Session activity could not be confirmed',
      );
    }
    if (count !== 1)
      throw new UnauthorizedException('Sign in again to continue');
    return { status: true };
  }

  @Get('manager-access')
  @StaffRoles('manager')
  managerAccess() {
    return { role: 'manager' };
  }
}
