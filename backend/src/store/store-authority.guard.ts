import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { StoreAuthorityService } from './store-authority.service.js';
import {
  STORE_WRITE_SCOPE,
  type StoreWriteScope,
} from './store-write.metadata.js';

@Injectable()
export class StoreAuthorityGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(StoreAuthorityService)
    private readonly authority: StoreAuthorityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const method = context.switchToHttp().getRequest<Request>().method;
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
    const scope = this.reflector.getAllAndOverride<StoreWriteScope>(
      STORE_WRITE_SCOPE,
      [context.getHandler(), context.getClass()],
    );
    if (scope) await this.authority.assertWriteAllowed(scope);
    return true;
  }
}
