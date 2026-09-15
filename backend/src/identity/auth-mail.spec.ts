import { createAuthMailer } from './auth-mail.js';
import { parseSmtpEnvironment } from './smtp.config.js';
import { Logger } from '@nestjs/common';

const { createTransport, sendMail } = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));
vi.mock('nodemailer', () => ({ default: { createTransport } }));
beforeEach(() => {
  vi.clearAllMocks();
  createTransport.mockReturnValue({ sendMail });
});
afterEach(() => vi.restoreAllMocks());
const config = parseSmtpEnvironment({
  AUTH_EMAIL_ENABLED: 'true',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_USER: 'test@example.test',
  SMTP_PASSWORD: 'private-test-password',
  SMTP_FROM: 'test@example.test',
});
const message = {
  userId: 'user',
  to: 'recipient@example.test',
  purpose: 'reset' as const,
  token: 'private-test-token',
};

it('requires TLS with certificate checking and disables message/credential logging', () => {
  createAuthMailer(config, 'http://localhost:5173');
  expect(createTransport).toHaveBeenCalledWith(
    expect.objectContaining({
      requireTLS: true,
      secure: false,
      tls: expect.objectContaining({ rejectUnauthorized: true }),
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    }),
  );
  expect(sendMail).not.toHaveBeenCalled();
});
it('places the token in a first-party URL fragment and requires SMTP acceptance', async () => {
  sendMail.mockResolvedValue({ accepted: [message.to], rejected: [] });
  await createAuthMailer(config, 'http://localhost:5173').send(message);
  expect(sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      text: expect.stringContaining(
        'http://localhost:5173/#reset=private-test-token',
      ),
    }),
  );
});
it('reports a sanitized failure and never prints raw transport errors', async () => {
  const log = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  sendMail.mockRejectedValue(
    new Error('SMTP_PASSWORD=private-test-password private-test-token'),
  );
  await expect(
    createAuthMailer(config, 'http://localhost:5173').send(message),
  ).rejects.toThrow('temporarily unavailable');
  expect(JSON.stringify(log.mock.calls)).not.toContain('private-test');
});
it('refuses disabled delivery instead of reporting a sent email', async () => {
  await expect(
    createAuthMailer(null, 'http://localhost:5173').send(message),
  ).rejects.toThrow('not configured');
  expect(sendMail).not.toHaveBeenCalled();
});
