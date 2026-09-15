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

import { PUBLIC, ROLES, type StaffRole } from './access.metadata.js';
export type StaffRequest = Request & { staff: StaffSession };

@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: PayGoAuth,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = context.switchToHttp().getRequest<StaffRequest>();
    let session: StaffSession | null;
    try {
      session = await this.auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
    } catch {
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
    if (required && !required.includes(role)) throw new ForbiddenException();
    req.staff = session;
    return true;
  }
}
