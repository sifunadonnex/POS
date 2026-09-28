import { createHash, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config/environment.js';
import { InvalidGatewayCallbackError } from './payment-gateway.js';
import type {
  GatewayCallbackResult,
  GatewayPaymentInput,
  GatewayPaymentResult,
  PaymentGateway,
} from './payment-gateway.js';

type DarajaConfig = NonNullable<AppConfig['daraja']>;
type Fetcher = typeof fetch;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Daraja returned an invalid response');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result && result.length <= maximum ? result : undefined;
}

function detail(prefix: string, value: unknown): string {
  const suffix = String(value ?? 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70);
  return `${prefix}_${suffix || 'unknown'}`;
}

function nairobiTimestamp(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}${part('month')}${part('day')}${part('hour')}${part('minute')}${part('second')}`;
}

function metadataValue(value: unknown, name: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const metadata = (value as Record<string, unknown>).CallbackMetadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }
  const items = (metadata as Record<string, unknown>).Item;
  if (!Array.isArray(items)) return undefined;
  for (const candidate of items) {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      continue;
    }
    const item = candidate as Record<string, unknown>;
    if (item.Name === name) return item.Value;
  }
  return undefined;
}

export class DarajaMpesaGateway implements PaymentGateway {
  readonly name = 'daraja_mpesa';
  private accessToken: { value: string; expiresAt: number } | null = null;
  private readonly baseUrl: string;

  constructor(
    private readonly config: DarajaConfig,
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.baseUrl =
      config.environment === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke';
  }

  supports(kind: 'card' | 'mpesa'): boolean {
    return kind === 'mpesa';
  }

  async initiate(input: GatewayPaymentInput): Promise<GatewayPaymentResult> {
    if (input.kind !== 'mpesa' || !input.payerPhone) {
      return { status: 'failed', detailCode: 'missing_mpesa_phone' };
    }
    if (input.amountMinor % 100 !== 0) {
      return { status: 'failed', detailCode: 'amount_not_whole_kes' };
    }
    const timestamp = nairobiTimestamp(this.now());
    const response = await this.request('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: this.config.shortCode,
      Password: Buffer.from(
        `${this.config.shortCode}${this.config.passkey}${timestamp}`,
      ).toString('base64'),
      Timestamp: timestamp,
      TransactionType: this.config.transactionType,
      Amount: input.amountMinor / 100,
      PartyA: input.payerPhone,
      PartyB: this.config.shortCode,
      PhoneNumber: input.payerPhone,
      CallBackURL: this.callbackUrl(),
      AccountReference: input.attemptId.replaceAll('-', '').slice(0, 12),
      TransactionDesc: 'PayGo sale',
    });
    const responseCode = String(response.ResponseCode ?? '');
    const checkoutRequestId = text(response.CheckoutRequestID);
    if (responseCode !== '0' || !checkoutRequestId) {
      return {
        status: 'failed',
        providerEventId: text(response.MerchantRequestID),
        detailCode: detail('stk_rejected', responseCode),
      };
    }
    return {
      status: 'pending',
      providerReference: checkoutRequestId,
      providerEventId: text(response.MerchantRequestID),
      detailCode: 'stk_accepted',
    };
  }

  async reconcile(input: GatewayPaymentInput): Promise<GatewayPaymentResult> {
    if (!input.providerReference) {
      return { status: 'unknown', detailCode: 'missing_checkout_reference' };
    }
    const timestamp = nairobiTimestamp(this.now());
    const response = await this.request('/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: this.config.shortCode,
      Password: Buffer.from(
        `${this.config.shortCode}${this.config.passkey}${timestamp}`,
      ).toString('base64'),
      Timestamp: timestamp,
      CheckoutRequestID: input.providerReference,
    });
    if (response.ResultCode === undefined) {
      return {
        status: 'pending',
        providerReference: input.providerReference,
        providerEventId: text(response.MerchantRequestID),
        detailCode: 'query_pending',
      };
    }
    const resultCode = String(response.ResultCode);
    if (resultCode === '0') {
      return {
        status: 'unknown',
        providerReference: input.providerReference,
        providerEventId: text(response.MerchantRequestID),
        detailCode: 'query_completed_without_amount',
      };
    }
    return {
      status: 'failed',
      providerReference: input.providerReference,
      providerEventId: text(response.MerchantRequestID),
      detailCode: detail('query_result', resultCode),
    };
  }

  callback(token: unknown, value: unknown): GatewayCallbackResult {
    if (!this.matchesCallbackToken(token)) {
      throw new InvalidGatewayCallbackError('Invalid Daraja callback token');
    }
    const body = object(value).Body;
    const callback = object(object(body).stkCallback);
    const providerReference = text(callback.CheckoutRequestID);
    if (!providerReference) throw new Error('Missing checkout request ID');
    const resultCode = String(callback.ResultCode ?? '');
    const merchantRequestId = text(callback.MerchantRequestID);
    if (resultCode !== '0') {
      return {
        status: 'failed',
        providerReference,
        providerEventId: merchantRequestId,
        detailCode: detail('callback_result', resultCode),
      };
    }
    const amount = metadataValue(callback, 'Amount');
    const receipt = text(metadataValue(callback, 'MpesaReceiptNumber'));
    if (
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isSafeInteger(amount) ||
      !Number.isSafeInteger(amount * 100) ||
      !receipt
    ) {
      return {
        status: 'unknown',
        providerReference,
        providerEventId: merchantRequestId,
        detailCode: 'callback_confirmation_incomplete',
      };
    }
    return {
      status: 'confirmed',
      amountMinor: amount * 100,
      providerReference,
      providerEventId: receipt,
      detailCode: 'callback_confirmed',
    };
  }

  private callbackUrl(): string {
    const url = new URL(this.config.callbackUrl);
    url.searchParams.set('token', this.config.callbackToken);
    return url.toString();
  }

  private matchesCallbackToken(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const expected = createHash('sha256')
      .update(this.config.callbackToken)
      .digest();
    const received = createHash('sha256').update(value).digest();
    return timingSafeEqual(expected, received);
  }

  private async request(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const token = await this.token();
    const response = await this.fetchJson(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return object(response);
  }

  private async token(): Promise<string> {
    const now = this.now().getTime();
    if (this.accessToken && this.accessToken.expiresAt > now + 60_000) {
      return this.accessToken.value;
    }
    const credentials = Buffer.from(
      `${this.config.consumerKey}:${this.config.consumerSecret}`,
    ).toString('base64');
    const response = object(
      await this.fetchJson(
        `${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
        { method: 'GET', headers: { Authorization: `Basic ${credentials}` } },
      ),
    );
    const accessToken = text(response.access_token, 2000);
    const expiresIn = Number(response.expires_in ?? 3600);
    if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error('Daraja returned an invalid access token');
    }
    this.accessToken = {
      value: accessToken,
      expiresAt: now + Math.min(expiresIn, 3600) * 1000,
    };
    return accessToken;
  }

  private async fetchJson(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetcher(url, {
        ...init,
        signal: controller.signal,
      });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error('Daraja request was rejected');
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }
}
