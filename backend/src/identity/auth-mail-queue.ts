import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APIError } from 'better-auth/api';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { DatabaseService } from '../database/database.service.js';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';
import {
  createAuthMailer,
  type AuthMailer,
  type AuthMessage,
} from './auth-mail.js';

type MailJob = {
  id: string;
  user_id: string;
  payload: string;
  attempts: number;
};

@Injectable()
export class AuthMailQueue
  implements AuthMailer, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('AuthMailQueue');
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private stopped = false;
  private readonly sender: AuthMailer;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {
    this.sender = createAuthMailer(config.smtp, config.baseURL);
  }

  async send(message: AuthMessage): Promise<void> {
    if (!this.config.smtp)
      throw new APIError('SERVICE_UNAVAILABLE', {
        message: 'Email delivery is not configured.',
      });
    const payload = await symmetricEncrypt({
      key: this.config.secret,
      data: JSON.stringify(message),
    });
    try {
      await this.database.connectionPool.query(
        'INSERT INTO auth_mail_outbox (id, user_id, payload) VALUES ($1, $2, $3)',
        [randomUUID(), message.userId, payload],
      );
    } catch {
      throw new APIError('SERVICE_UNAVAILABLE', {
        message: 'The email request could not be saved. Please retry.',
      });
    }
  }

  onApplicationBootstrap() {
    // Tests inject a mail collector and never start external SMTP delivery.
    if (!this.config.smtp || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      if (this.stopped || this.running) return;
      this.running = this.deliverBatch()
        .catch(() => {
          this.logger.error('Authentication email queue is unavailable');
        })
        .finally(() => {
          this.running = null;
        });
    }, 10_000);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  async deliverBatch(): Promise<void> {
    const pool = this.database.connectionPool;
    await pool.query(
      "UPDATE auth_mail_outbox SET status = 'failed', payload = NULL WHERE status IN ('pending', 'sending') AND expires_at <= now()",
    );
    const claimed = await pool.query<MailJob>(
      `WITH ready AS (
        SELECT id FROM auth_mail_outbox WHERE payload IS NOT NULL AND attempts < 3 AND expires_at > now()
        AND ((status = 'pending' AND available_at <= now()) OR (status = 'sending' AND locked_at < now() - interval '5 minutes'))
        ORDER BY available_at LIMIT 5 FOR UPDATE SKIP LOCKED
      ) UPDATE auth_mail_outbox m SET status = 'sending', attempts = attempts + 1, locked_at = now()
      FROM ready WHERE m.id = ready.id RETURNING m.id, m.user_id, m.payload, m.attempts`,
    );
    for (const job of claimed.rows) {
      let success = false;
      try {
        const payload: unknown = JSON.parse(
          await symmetricDecrypt({
            key: this.config.secret,
            data: job.payload,
          }),
        );
        if (
          !payload ||
          typeof payload !== 'object' ||
          !('to' in payload) ||
          typeof payload.to !== 'string' ||
          !('token' in payload) ||
          typeof payload.token !== 'string' ||
          !('purpose' in payload) ||
          (payload.purpose !== 'reset' && payload.purpose !== 'verify')
        )
          throw new Error('Invalid email job');
        await this.sender.send({
          userId: job.user_id,
          to: payload.to,
          token: payload.token,
          purpose: payload.purpose,
        });
        success = true;
      } catch {
        this.logger.error(
          'Authentication email delivery failed; a bounded retry will be recorded',
        );
      }
      const status = success
        ? 'sent'
        : job.attempts >= 3
          ? 'failed'
          : 'pending';
      // Claim attempt protects against a stale worker overwriting a later delivery attempt.
      await pool.query(
        `WITH changed AS (UPDATE auth_mail_outbox SET status = $2, payload = CASE WHEN $2 = 'pending' THEN payload ELSE NULL END,
          available_at = now() + interval '1 minute', locked_at = NULL WHERE id = $1 AND status = 'sending' AND attempts = $3 RETURNING user_id)
        INSERT INTO auth_audit (subject_id, action, outcome) SELECT user_id, $4, $5 FROM changed`,
        [
          job.id,
          status,
          job.attempts,
          success ? 'email.smtp-accepted' : 'email.delivery-failed',
          success ? 'success' : 'failure',
        ],
      );
    }
  }
}
