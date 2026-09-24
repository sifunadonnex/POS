import { Injectable } from '@nestjs/common';

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export type ExternalPaymentKind = 'card' | 'mpesa';
export type PaymentAttemptStatus =
  'pending' | 'confirmed' | 'failed' | 'unknown';

export type GatewayPaymentInput = {
  attemptId: string;
  saleId: string;
  kind: ExternalPaymentKind;
  amountMinor: number;
  providerReference?: string;
};

export type GatewayPaymentResult = {
  status: PaymentAttemptStatus;
  amountMinor?: number;
  providerReference?: string;
  providerEventId?: string;
  detailCode?: string;
};

export interface PaymentGateway {
  readonly name: string;
  supports(kind: ExternalPaymentKind): boolean;
  initiate(input: GatewayPaymentInput): Promise<GatewayPaymentResult>;
  reconcile(input: GatewayPaymentInput): Promise<GatewayPaymentResult>;
}

@Injectable()
export class DisabledPaymentGateway implements PaymentGateway {
  readonly name = 'disabled';

  supports(): boolean {
    return false;
  }

  initiate(): Promise<GatewayPaymentResult> {
    throw new Error('External payments are not configured');
  }

  reconcile(): Promise<GatewayPaymentResult> {
    throw new Error('External payments are not configured');
  }
}
