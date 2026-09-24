import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { PaymentAttemptsService } from './payment-attempts.service.js';

function actor(req: StaffRequest) {
  return { userId: req.staff.user.id, sessionId: req.staff.session.id };
}

@Controller('api/payment-attempts')
export class PaymentAttemptsController {
  constructor(
    @Inject(PaymentAttemptsService)
    private readonly attempts: PaymentAttemptsService,
  ) {}

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
