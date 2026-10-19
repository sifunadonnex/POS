import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { verifyPassword } from 'better-auth/crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import { objectInput, textInput } from '../catalogue/catalogue.input.js';
import { selectedDepartment } from '../business/business-scope.js';

export type CartApprovalProof = {
  approverId: string;
  credentialHash: string;
  reason: string;
};

@Injectable()
export class CartApprovalService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  async prepare(
    actorId: string,
    value: unknown,
  ): Promise<CartApprovalProof | null> {
    if (value === undefined || value === null) return null;
    const input = objectInput(value);
    const email = textInput(input.email, 'supervisor email', 254).toLowerCase();
    const password =
      typeof input.password === 'string' && input.password.length <= 128
        ? input.password
        : '';
    const reason = textInput(input.reason, 'approval reason', 200);
    if (reason.length < 3)
      throw new ForbiddenException('Provide a reason for approval');
    // Persist throttling outside the business transaction so failures cannot reset it.
    const rate = await this.database.connectionPool.query<{ count: number }>(
      `INSERT INTO "rateLimit" (id, key, count, "lastRequest") VALUES ($1, $2, 1, $3)
       ON CONFLICT (key) DO UPDATE SET count = CASE WHEN "rateLimit"."lastRequest" < $3 - 60000 THEN 1 ELSE "rateLimit".count + 1 END,
       "lastRequest" = CASE WHEN "rateLimit"."lastRequest" < $3 - 60000 THEN $3 ELSE "rateLimit"."lastRequest" END RETURNING count`,
      [randomUUID(), `cart-approval:${actorId}`, Date.now()],
    );
    if (!rate.rows[0] || rate.rows[0].count > 5)
      throw new HttpException(
        'Too many approval attempts. Wait a minute.',
        429,
      );
    const staff = await this.database.connectionPool.query<{
      id: string;
      password: string;
    }>(
      `SELECT u.id, a.password FROM "user" u JOIN account a ON a."userId" = u.id AND a."providerId" = 'credential'
       WHERE lower(u.email) = $1 AND NOT u.disabled AND u.archived_at IS NULL AND u."emailVerified" AND u."twoFactorEnabled"
       AND u.role IN ('manager', 'supervisor') AND (u.role = 'manager' OR EXISTS (
         SELECT 1 FROM staff_department_access access WHERE access.user_id = u.id AND access.department_id = $2
         AND (access.home OR access.expires_at > now())))`,
      [email, selectedDepartment()],
    );
    const approver = staff.rows[0];
    if (
      !approver ||
      typeof approver.password !== 'string' ||
      !password ||
      !(await verifyPassword({ hash: approver.password, password }))
    ) {
      await this.database.connectionPool.query(
        "INSERT INTO auth_audit(actor_id, action, outcome) VALUES ($1, 'cart.approval', 'denied')",
        [actorId],
      );
      throw new ForbiddenException(
        'Approval failed. Check the supervisor account, password and department access.',
      );
    }
    return {
      approverId: approver.id,
      credentialHash: approver.password,
      reason,
    };
  }

  async verify(
    client: PoolClient,
    actorId: string,
    proof: CartApprovalProof | null,
    target:
      { kind: 'basket'; revision: number } | { kind: 'held-order'; id: string },
  ): Promise<string> {
    if (!proof)
      throw new ForbiddenException(
        'Supervisor approval is required for this change',
      );
    const current = await client.query(
      `SELECT u.id FROM "user" u JOIN account a ON a."userId" = u.id AND a."providerId" = 'credential'
       WHERE u.id = $1 AND a.password = $2 AND NOT u.disabled AND u.archived_at IS NULL AND u."emailVerified" AND u."twoFactorEnabled"
       AND u.role IN ('manager', 'supervisor') AND (u.role = 'manager' OR EXISTS (SELECT 1 FROM staff_department_access access
       WHERE access.user_id = u.id AND access.department_id = $3 AND (access.home OR access.expires_at > now()))) FOR SHARE OF u, a`,
      [proof.approverId, proof.credentialHash, selectedDepartment()],
    );
    if (!current.rowCount)
      throw new ForbiddenException(
        'Supervisor access changed. Request approval again.',
      );
    await client.query(
      "INSERT INTO auth_audit(actor_id, subject_id, action, outcome, detail) VALUES ($1, $2, 'cart.approval', 'success', $3)",
      [
        proof.approverId,
        actorId,
        JSON.stringify({
          reason: proof.reason,
          departmentId: selectedDepartment(),
          target,
        }),
      ],
    );
    return proof.approverId;
  }
}
