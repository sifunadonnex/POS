import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { PublicRoute, StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { StoreWrites } from '../store/store-write.metadata.js';
import { PaymentAttemptsService } from './payment-attempts.service.js';

function actor(req: StaffRequest) {
  return { userId: req.staff.user.id, sessionId: req.staff.session.id };
}

@Controller('api/payment-attempts')
@StoreWrites('operational')
export class PaymentAttemptsController {
  constructor(
    @Inject(PaymentAttemptsService)
    private readonly attempts: PaymentAttemptsService,
  ) {}

  @Get('capabilities')
  @StaffRoles('cashier', 'manager')
  capabilities() {
    return this.attempts.capabilities();
  }

  @Post('mpesa/callback')
  @HttpCode(200)
  @PublicRoute()
  callback(@Query('token') token: unknown, @Body() body: unknown) {
    return this.attempts.callback(token, body);
  }

  @Post()
  @StaffRoles('cashier', 'manager')
  start(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.attempts.start(actor(req), body);
  }

  @Get(':attemptId')
  @StaffRoles('cashier', 'manager')
  get(@Req() req: StaffRequest, @Param('attemptId') attemptId: string) {
    return this.attempts.get(actor(req), attemptId);
  }

  @Post(':attemptId/reconcile')
  @StaffRoles('cashier', 'manager')
  reconcile(@Req() req: StaffRequest, @Param('attemptId') attemptId: string) {
    return this.attempts.reconcile(actor(req), attemptId);
  }
}
