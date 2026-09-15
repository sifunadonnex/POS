import { Logger } from '@nestjs/common';
import { APIError } from 'better-auth/api';
import nodemailer from 'nodemailer';
import type { SmtpConfig } from './smtp.config.js';

export type AuthMessage = {
  userId: string;
  to: string;
  purpose: 'reset' | 'verify';
  token: string;
};
export type AuthMailer = { send(message: AuthMessage): Promise<void> };
export const AUTH_MAILER = Symbol('AUTH_MAILER');

export function createAuthMailer(
  config: SmtpConfig | null,
  origin: string,
): AuthMailer {
  const logger = new Logger('AuthMail');
  const transport = config
    ? nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.port === 465,
        requireTLS: true,
        tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
        auth: { user: config.user, pass: config.password },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 8000,
        dnsTimeout: 5000,
        disableFileAccess: true,
        disableUrlAccess: true,
        logger: false,
        debug: false,
      })
    : null;
  return {
    async send(message) {
      if (!transport || !config)
        throw new APIError('SERVICE_UNAVAILABLE', {
          message: 'Email delivery is not configured.',
        });
      // Fragments are not sent in HTTP requests or Referer headers. No external assets or tracking.
      const url = `${origin}/#${message.purpose}=${encodeURIComponent(message.token)}`;
      try {
        const result = await transport.sendMail({
          from: { name: 'Pay & Go', address: config.from },
          to: { address: message.to, name: '' },
          subject:
            message.purpose === 'reset'
              ? 'Reset your Pay & Go password'
              : 'Verify your Pay & Go email',
          text: `${message.purpose === 'reset' ? 'Choose a new password' : 'Verify your email address'} using this link:\n\n${url}\n\nThis link expires in 30 minutes. If you did not request this, ignore this email.`,
        });
        if (result.accepted.length !== 1 || result.rejected.length > 0)
          throw new Error('Delivery was not accepted');
      } catch {
        logger.error(
          'Authentication email delivery failed; check SMTP configuration privately',
        );
        throw new APIError('SERVICE_UNAVAILABLE', {
          message: 'Email delivery is temporarily unavailable. Please retry.',
        });
      }
    },
  };
}
