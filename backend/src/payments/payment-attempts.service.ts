import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  PaymentAttemptsStore,
  type PaymentActor,
  type PaymentAttemptRecord,
  type PaymentAttemptResult,
  type PersistedGatewayResult,
} from './payment-attempts.store.js';
import {
  PAYMENT_GATEWAY,
  type ExternalPaymentKind,
  type GatewayPaymentResult,
  type PaymentAttemptStatus,
  type PaymentGateway,
} from './payment-gateway.js';

type StartAttemptBody = {
  requestId?: unknown;
  saleId?: unknown;
  kind?: unknown;
  reason?: unknown;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value.trim())) {
    throw new BadRequestException(`Provide a valid ${label}`);
  }
  return value.trim();
}

function text(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.trim().length < 3 ||
    value.trim().length > maximum
  ) {
    throw new BadRequestException(
      `${label} must contain between three and ${maximum} characters`,
    );
  }
  return value.trim();
}

function kind(value: unknown): ExternalPaymentKind {
  if (value !== 'card' && value !== 'mpesa') {
    throw new BadRequestException('Payment kind must be card or mpesa');
  }
  return value;
}

function providerText(value: unknown, maximum = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result && result.length <= maximum ? result : undefined;
}

function detailCode(value: unknown): string | undefined {
  const result = providerText(value, 100);
  return result && /^[a-z0-9][a-z0-9_.-]{0,99}$/.test(result)
    ? result
    : undefined;
}

@Injectable()
export class PaymentAttemptsService {
  constructor(
    @Inject(PaymentAttemptsStore)
    private readonly store: PaymentAttemptsStore,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async start(
    actor: PaymentActor,
    value: unknown,
  ): Promise<PaymentAttemptResult> {
    const body =
      value && typeof value === 'object' ? (value as StartAttemptBody) : {};
    const requestId = uuid(body.requestId, 'request ID');
    const saleId = uuid(body.saleId, 'sale ID');
    const paymentKind = kind(body.kind);
    const reason = text(body.reason, 'Reason', 200);
    if (!this.gateway.supports(paymentKind)) {
      throw new ConflictException(
        'Card and M-Pesa payments are not configured for this register',
      );
    }
    if (!/^[a-z0-9][a-z0-9_.-]{0,49}$/.test(this.gateway.name)) {
      throw new Error('Payment gateway name is invalid');
    }

    const payload = { saleId, kind: paymentKind, reason };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
    const prepared = await this.store.prepare(
      actor,
      requestId,
      fingerprint,
      payload,
      this.gateway.name,
    );
    if (!prepared.created) return this.store.toResult(prepared.record);

    let result: GatewayPaymentResult;
    try {
      result = await this.gateway.initiate({
        attemptId: prepared.record.id,
        saleId: prepared.record.sale_id,
        kind: prepared.record.kind,
        amountMinor: Number(prepared.record.amount_minor),
      });
    } catch {
      result = {
        status: 'unknown',
        detailCode: 'initiation_unavailable',
      };
    }
    return this.store.apply(
      prepared.record.id,
      'initiation',
      this.normalizeGatewayResult(prepared.record, result),
    );
  }

  async get(
    actor: PaymentActor,
    attemptIdValue: unknown,
  ): Promise<PaymentAttemptResult> {
    const attemptId = uuid(attemptIdValue, 'payment attempt ID');
    return this.store.toResult(await this.store.authorized(actor, attemptId));
  }

  async reconcile(
    actor: PaymentActor,
    attemptIdValue: unknown,
  ): Promise<PaymentAttemptResult> {
    const attemptId = uuid(attemptIdValue, 'payment attempt ID');
    const attempt = await this.store.authorized(actor, attemptId);
    if (attempt.status === 'confirmed' || attempt.status === 'failed') {
      return this.store.toResult(attempt);
    }
    if (
      attempt.provider !== this.gateway.name ||
      !this.gateway.supports(attempt.kind)
    ) {
      throw new ConflictException(
        'The payment provider is unavailable; reconciliation is still required',
      );
    }

    let result: GatewayPaymentResult;
    try {
      result = await this.gateway.reconcile({
        attemptId: attempt.id,
        saleId: attempt.sale_id,
        kind: attempt.kind,
        amountMinor: Number(attempt.amount_minor),
        providerReference: attempt.provider_reference ?? undefined,
      });
    } catch {
      result = {
        status: 'unknown',
        providerReference: attempt.provider_reference ?? undefined,
        detailCode: 'reconciliation_unavailable',
      };
    }
    return this.store.apply(
      attempt.id,
      'reconciliation',
      this.normalizeGatewayResult(attempt, result),
    );
  }

  private normalizeGatewayResult(
    attempt: PaymentAttemptRecord,
    result: GatewayPaymentResult,
  ): PersistedGatewayResult {
    const status: PaymentAttemptStatus = [
      'pending',
      'confirmed',
      'failed',
      'unknown',
    ].includes(result.status)
      ? result.status
      : 'unknown';
    const receivedReference = providerText(result.providerReference);
    const existingReference = attempt.provider_reference ?? undefined;
    const providerEventId = providerText(result.providerEventId);
    if (
      receivedReference &&
      existingReference &&
      receivedReference !== existingReference
    ) {
      return {
        status: 'unknown',
        providerReference: existingReference,
        providerEventId,
        detailCode: 'provider_reference_mismatch',
      };
    }
    const providerReference = receivedReference ?? existingReference;
    let code = detailCode(result.detailCode);
    if (
      status === 'confirmed' &&
      (!providerReference ||
        !Number.isSafeInteger(result.amountMinor) ||
        result.amountMinor !== Number(attempt.amount_minor))
    ) {
      return {
        status: 'unknown',
        providerReference,
        providerEventId,
        detailCode: 'confirmation_mismatch',
      };
    }
    if (!code && status === 'unknown') code = 'provider_status_unknown';
    return {
      status,
      providerReference,
      providerEventId,
      detailCode: code,
    };
  }
}
