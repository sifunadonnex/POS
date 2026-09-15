import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { DatabaseService } from '../database/database.service.js';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';
import { AuthMailQueue } from './auth-mail-queue.js';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('./auth-mail.js', () => ({ createAuthMailer: () => ({ send }) }));
const config: AuthConfig = {
  secret: 'test-only-mail-encryption-key-with-at-least-32-characters',
  baseURL: 'http://localhost:5173',
  secureCookies: false,
  smtp: {
    host: 'smtp.example.test',
    port: 587,
    user: 'sender@example.test',
    password: 'test-password',
    from: 'sender@example.test',
  },
};
const message = {
  userId: 'staff-id',
  to: 'staff@example.test',
  purpose: 'reset' as const,
  token: 'test-only-secret-reset-token',
};
let queue: AuthMailQueue;
const query = vi.fn();

beforeEach(async () => {
  vi.resetAllMocks();
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  const module = await Test.createTestingModule({
    providers: [
      AuthMailQueue,
      { provide: AUTH_CONFIG, useValue: config },
      { provide: DatabaseService, useValue: { connectionPool: { query } } },
    ],
  }).compile();
  queue = module.get(AuthMailQueue);
});
afterEach(() => vi.restoreAllMocks());

it('durably saves encrypted email content without sending during the request', async () => {
  await queue.send(message);
  const payload: unknown = query.mock.calls[0]?.[1]?.[2];
  expect(typeof payload).toBe('string');
  if (typeof payload !== 'string') throw new Error('Missing encrypted job');
  expect(payload).not.toContain(message.token);
  expect(payload).not.toContain(message.to);
  expect(
    JSON.parse(await symmetricDecrypt({ key: config.secret, data: payload })),
  ).toEqual(message);
  expect(send).not.toHaveBeenCalled();
});

it('reports failure when a durable email request cannot be saved', async () => {
  query.mockRejectedValue(new Error('private database diagnostic'));
  await expect(queue.send(message)).rejects.toThrow('could not be saved');
  expect(send).not.toHaveBeenCalled();
});

it.each([
  {
    attempts: 1,
    failure: false,
    status: 'sent',
    action: 'email.smtp-accepted',
  },
  {
    attempts: 1,
    failure: true,
    status: 'pending',
    action: 'email.delivery-failed',
  },
  {
    attempts: 3,
    failure: true,
    status: 'failed',
    action: 'email.delivery-failed',
  },
])(
  'records $status after delivery attempt $attempts',
  async ({ attempts, failure, status, action }) => {
    const payload = await symmetricEncrypt({
      key: config.secret,
      data: JSON.stringify(message),
    });
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ id: 'job-id', user_id: message.userId, payload, attempts }],
    });
    if (failure) send.mockRejectedValue(new Error('SMTP diagnostic'));
    else send.mockResolvedValue(undefined);
    await queue.deliverBatch();
    expect(send).toHaveBeenCalledExactlyOnceWith(message);
    expect(query.mock.calls[2]?.[1]).toEqual([
      'job-id',
      status,
      attempts,
      action,
      failure ? 'failure' : 'success',
    ]);
  },
);

it('rejects damaged encrypted jobs without calling SMTP', async () => {
  query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
    rows: [
      {
        id: 'job-id',
        user_id: message.userId,
        payload: 'invalid-ciphertext',
        attempts: 3,
      },
    ],
  });
  await queue.deliverBatch();
  expect(send).not.toHaveBeenCalled();
  expect(query.mock.calls[2]?.[1]).toEqual([
    'job-id',
    'failed',
    3,
    'email.delivery-failed',
    'failure',
  ]);
});
