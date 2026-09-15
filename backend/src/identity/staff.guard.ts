import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import { AUTH, type PayGoAuth, type StaffSession } from './auth.js';

import {
  PUBLIC,
  ROLES,
  SECURITY_SETUP,
  type StaffRole,
} from './access.metadata.js';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';
import { DatabaseService } from '../database/database.service.js';
import { SecurityStore } from './security-store.js';
import { needsMfa } from './security-policy.js';
import { isAPIError } from 'better-auth/api';
export type StaffRequest = Request & { staff: StaffSession };

@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: PayGoAuth,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = context.switchToHttp().getRequest<StaffRequest>();
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin !== this.config.baseURL
    ) {
      throw new ForbiddenException('Untrusted request origin');
    }
    let session: StaffSession | null;
    try {
      session = await this.auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (session)
        await new SecurityStore(this.database.connectionPool).requireActive(
          session,
        );
    } catch (error) {
      if (isAPIError(error) && error.statusCode === 401)
        throw new UnauthorizedException('Sign in again to continue');
      throw new ServiceUnavailableException(
        'Authentication is temporarily unavailable',
      );
    }
    if (!session) throw new UnauthorizedException();
    const role = session.user.role;
    if (role !== 'manager' && role !== 'cashier')
      throw new ForbiddenException();
    const required = this.reflector.getAllAndOverride<StaffRole[]>(
      ROLES,
      targets,
    );
    const validatedRole: StaffRole = role === 'manager' ? 'manager' : 'cashier';
    if (required && !required.includes(validatedRole))
      throw new ForbiddenException();
    if (
      !this.reflector.getAllAndOverride<boolean>(SECURITY_SETUP, targets) &&
      needsMfa(session)
    ) {
      throw new ForbiddenException('Complete two-factor authentication first');
    }
    req.staff = session;
    return true;
  }
}
