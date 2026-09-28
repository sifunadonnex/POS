import { InvalidGatewayCallbackError } from './payment-gateway.js';
import { DarajaMpesaGateway } from './daraja-mpesa.gateway.js';

const config = {
  environment: 'sandbox',
  consumerKey: 'consumer-key',
  consumerSecret: 'consumer-secret',
  shortCode: '174379',
  passkey: 'sandbox-online-passkey',
  transactionType: 'CustomerPayBillOnline',
  callbackUrl:
    'https://payments.example.test/api/payment-attempts/mpesa/callback',
  callbackToken: 'a'.repeat(32),
} as const;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DarajaMpesaGateway', () => {
  it('uses OAuth and starts an STK Push with a protected callback URL', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      jsonResponse({ access_token: 'access-token', expires_in: '3599' }),
      jsonResponse({
        ResponseCode: '0',
        MerchantRequestID: 'merchant-123',
        CheckoutRequestID: 'ws_CO_123',
      }),
    ];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      const response = responses.shift();
      if (!response) throw new Error('Unexpected request');
      return response;
    };
    const gateway = new DarajaMpesaGateway(
      config,
      fetcher,
      () => new Date('2026-09-28T10:20:30.000Z'),
    );

    await expect(
      gateway.initiate({
        attemptId: '11111111-1111-4111-8111-111111111111',
        saleId: '22222222-2222-4222-8222-222222222222',
        kind: 'mpesa',
        amountMinor: 2500,
        payerPhone: '254712345678',
      }),
    ).resolves.toEqual({
      status: 'pending',
      providerReference: 'ws_CO_123',
      providerEventId: 'merchant-123',
      detailCode: 'stk_accepted',
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    });
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('consumer-key:consumer-secret').toString('base64')}`,
    });
    expect(calls[1].url).toBe(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
    );
    expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({
      BusinessShortCode: '174379',
      Timestamp: '20260928132030',
      Amount: 25,
      PartyA: '254712345678',
      PhoneNumber: '254712345678',
      CallBackURL: `${config.callbackUrl}?token=${config.callbackToken}`,
    });
  });

  it('only confirms a successful callback containing an integer amount and receipt', () => {
    const gateway = new DarajaMpesaGateway(config);
    const callback = {
      Body: {
        stkCallback: {
          MerchantRequestID: 'merchant-123',
          CheckoutRequestID: 'ws_CO_123',
          ResultCode: 0,
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 25 },
              { Name: 'MpesaReceiptNumber', Value: 'QAA123' },
            ],
          },
        },
      },
    };

    expect(gateway.callback(config.callbackToken, callback)).toEqual({
      status: 'confirmed',
      amountMinor: 2500,
      providerReference: 'ws_CO_123',
      providerEventId: 'QAA123',
      detailCode: 'callback_confirmed',
    });
    expect(() => gateway.callback('wrong-token', callback)).toThrow(
      InvalidGatewayCallbackError,
    );
    expect(
      gateway.callback(config.callbackToken, {
        Body: {
          stkCallback: {
            MerchantRequestID: 'merchant-123',
            CheckoutRequestID: 'ws_CO_123',
            ResultCode: 0,
          },
        },
      }),
    ).toEqual({
      status: 'unknown',
      providerReference: 'ws_CO_123',
      providerEventId: 'merchant-123',
      detailCode: 'callback_confirmation_incomplete',
    });
  });

  it('does not treat a successful status query as exact payment confirmation', async () => {
    const responses = [
      jsonResponse({ access_token: 'access-token', expires_in: 3599 }),
      jsonResponse({
        ResultCode: '0',
        MerchantRequestID: 'merchant-123',
      }),
    ];
    const fetcher: typeof fetch = async () => {
      const response = responses.shift();
      if (!response) throw new Error('Unexpected request');
      return response;
    };
    const gateway = new DarajaMpesaGateway(config, fetcher);

    await expect(
      gateway.reconcile({
        attemptId: '11111111-1111-4111-8111-111111111111',
        saleId: '22222222-2222-4222-8222-222222222222',
        kind: 'mpesa',
        amountMinor: 2500,
        providerReference: 'ws_CO_123',
      }),
    ).resolves.toMatchObject({
      status: 'unknown',
      detailCode: 'query_completed_without_amount',
    });
  });

  it('rejects fractional-KES initiation before contacting Daraja', async () => {
    let contacted = false;
    const fetcher: typeof fetch = async () => {
      contacted = true;
      throw new Error('Unexpected request');
    };
    const gateway = new DarajaMpesaGateway(config, fetcher);

    await expect(
      gateway.initiate({
        attemptId: '11111111-1111-4111-8111-111111111111',
        saleId: '22222222-2222-4222-8222-222222222222',
        kind: 'mpesa',
        amountMinor: 2501,
        payerPhone: '254712345678',
      }),
    ).resolves.toEqual({
      status: 'failed',
      detailCode: 'amount_not_whole_kes',
    });
    expect(contacted).toBe(false);
  });
});
