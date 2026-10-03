import { APIError } from 'better-auth/api';
import type { Pool } from 'pg';
import { isIdle, type SecuritySession } from './security-policy.js';

export type AuditEvent = {
  actorId?: string;
  subjectId?: string;
  action: string;
  outcome: 'success' | 'failure' | 'challenge' | 'denied';
  detail?: Record<string, string | boolean | number>;
};

export class SecurityStore {
  constructor(
    private readonly pool: Pool,
    private readonly edgeMode = process.env.PAYGO_RUNTIME_MODE === 'edge',
  ) {}

  async audit(event: AuditEvent): Promise<void> {
    await this.pool.query(
      'INSERT INTO auth_audit (actor_id, subject_id, action, outcome, detail) VALUES ($1, $2, $3, $4, $5)',
      [
        event.actorId ?? null,
        event.subjectId ?? null,
        event.action,
        event.outcome,
        JSON.stringify(event.detail ?? {}),
      ],
    );
  }

  async requireActive(session: SecuritySession): Promise<void> {
    const roster = this.edgeMode
      ? await this.pool.query<{ fresh: boolean }>(
          `SELECT (s.last_roster_check_at IS NOT NULL
        AND s.last_roster_check_at <= now()
        AND s.last_roster_check_at > now() - interval '24 hours') AS fresh
       FROM store_bootstrap_state s
       JOIN store_bootstrap_application a ON a.store_id = s.store_id
       WHERE s.singleton AND s.runtime_mode = 'edge'`,
        )
      : null;
    if (
      session.user.disabled !== false ||
      !session.user.emailVerified ||
      isIdle(session) ||
      (roster?.rows[0] && !roster.rows[0].fresh)
    ) {
      await this.pool.query('DELETE FROM session WHERE id = $1', [
        session.session.id,
      ]);
      throw new APIError('UNAUTHORIZED', {
        message: 'Sign in again to continue.',
      });
    }
  }

  async confirmMfa(sessionId: string): Promise<void> {
    const result = await this.pool.query(
      'UPDATE session SET "mfaVerified" = true, "lastActivityAt" = now() WHERE id = $1 RETURNING id',
      [sessionId],
    );
    if (result.rowCount !== 1)
      throw new APIError('UNAUTHORIZED', {
        message: 'Sign in again to continue.',
      });
  }
}
