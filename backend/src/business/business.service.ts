import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import {
  objectInput,
  textInput,
  uuidInput,
  revisionInput,
} from '../catalogue/catalogue.input.js';
import {
  readProduct,
  recordHistory,
} from '../catalogue/catalogue.repository.js';

@Injectable()
export class BusinessService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async configuration(req: StaffRequest) {
    const manager = req.staff.user.role === 'manager';
    const pool = this.database.connectionPool;
    const departments = await pool.query<{
      id: string;
      branchId: string;
      branchName: string;
      name: string;
      home: boolean;
    }>(
      `SELECT d.id, d.branch_id AS "branchId", b.name AS "branchName", d.name,
       COALESCE(a.home, false) AS home FROM business_department d
       JOIN business_branch b ON b.id = d.branch_id
       LEFT JOIN staff_department_access a ON a.department_id = d.id AND a.user_id = $1
       WHERE d.active AND b.active AND ($2::boolean OR a.home OR a.expires_at > now()) ORDER BY lower(b.name), lower(d.name)`,
      [req.staff.user.id, manager],
    );
    const tills = await pool.query<{
      id: string;
      departmentId: string;
      name: string;
    }>(
      'SELECT id, department_id AS "departmentId", name FROM business_till WHERE active AND department_id = ANY($1::uuid[]) ORDER BY lower(name)',
      [departments.rows.map((d) => d.id)],
    );
    const settings = await pool.query<{
      expiryWarningDays: number | null;
      revision: number;
    }>(
      'SELECT expiry_warning_days AS "expiryWarningDays", revision FROM business_setting WHERE id',
    );
    return {
      departments: departments.rows,
      tills: tills.rows,
      settings: settings.rows[0],
    };
  }

  async administration() {
    const staff = await this.database.connectionPool.query(
      'SELECT id, name, email, role FROM "user" WHERE NOT disabled AND archived_at IS NULL ORDER BY lower(name)',
    );
    const assignments = await this.database.connectionPool.query(
      'SELECT user_id AS "userId", department_id AS "departmentId", home, expires_at AS "expiresAt" FROM staff_department_access ORDER BY user_id, department_id',
    );
    const unassigned = await this.database.connectionPool.query(
      'SELECT p.id, p.sku, p.name, p.revision, p.unit, COALESCE(s.quantity_minor, 0)::text AS "quantityMinor" FROM catalogue_product p LEFT JOIN inventory_stock s ON s.product_id = p.id WHERE p.department_id IS NULL ORDER BY lower(p.name), p.id LIMIT 101',
    );
    const openShifts = await this.database.connectionPool.query(
      `SELECT s.id, u.name AS "staffName", COALESCE(t.name, 'Unassigned till') AS "tillName" FROM cash_shift s JOIN "user" u ON u.id = s.cashier_id LEFT JOIN business_till t ON t.id = s.till_id WHERE s.status = 'open' ORDER BY s.opened_at`,
    );
    return {
      openShifts: openShifts.rows,
      staff: staff.rows,
      assignments: assignments.rows,
      unassignedProducts: unassigned.rows.slice(0, 100),
      moreUnassigned: unassigned.rows.length > 100,
    };
  }

  private async change<T>(
    req: StaffRequest,
    reason: string,
    action: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (reason.length < 3)
      throw new BadRequestException(
        'Provide a reason of at least three characters',
      );
    const client = await this.database.connectionPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '10s'");
      const allowed = await client.query(
        `SELECT u.id FROM "user" u JOIN session s ON s."userId" = u.id WHERE u.id = $1 AND s.id = $2
         AND u.role = 'manager' AND NOT u.disabled AND u."emailVerified" AND u."twoFactorEnabled" AND s."mfaVerified"
         AND s."expiresAt" > now() AND s."lastActivityAt" > now() - interval '15 minutes' FOR SHARE OF u, s`,
        [req.staff.user.id, req.staff.session.id],
      );
      if (!allowed.rowCount)
        throw new ForbiddenException('Verify manager access again');
      await client.query(
        "SELECT set_config('paygo.actor_id', $1, true), set_config('paygo.reason', $2, true)",
        [req.staff.user.id, reason],
      );
      const result = await work(client);
      await client.query(
        "INSERT INTO auth_audit(actor_id, action, outcome, detail) VALUES ($1, $2, 'success', $3)",
        [req.staff.user.id, action, JSON.stringify({ reason, result })],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof HttpException) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '23505'
      )
        throw new ConflictException(
          action === 'business.product.assigned'
            ? 'That SKU or barcode is already used in the destination department. Review the products before assigning stock.'
            : 'That name already exists. Reload before retrying.',
        );
      throw new ServiceUnavailableException(
        'Change could not be confirmed. Reload Settings before retrying.',
      );
    } finally {
      client.release();
    }
  }

  createBranch(req: StaffRequest, value: unknown) {
    const body = objectInput(value);
    const name = textInput(body.name, 'branch name', 100);
    const id = uuidInput(body.id, 'branch ID');
    const reason = textInput(body.reason, 'reason', 200);
    return this.change(
      req,
      reason,
      'business.branch.created',
      async (client) => {
        const local = await client.query(
          "SELECT store_id FROM store_bootstrap_state WHERE singleton AND checkout_authority = 'local' FOR SHARE",
        );
        if (local.rowCount)
          throw new ConflictException(
            'Branch setup requires hosted checkout authority; the legacy offline setup does not carry department data.',
          );
        await client.query(
          'INSERT INTO business_branch(id, name) VALUES ($1, $2)',
          [id, name],
        );
        for (const departmentName of ['POP N GO Minimart', 'POP N GO Liquor']) {
          const departmentId = randomUUID();
          await client.query(
            'INSERT INTO business_department(id, branch_id, name) VALUES ($1, $2, $3)',
            [departmentId, id, departmentName],
          );
          await client.query(
            'INSERT INTO business_till(id, department_id, name) VALUES ($1, $2, $3)',
            [randomUUID(), departmentId, `${departmentName} till`],
          );
        }
        return { branchId: id };
      },
    );
  }

  saveSettings(req: StaffRequest, value: unknown) {
    const body = objectInput(value);
    const days = body.expiryWarningDays;
    if (
      typeof days !== 'number' ||
      !Number.isInteger(days) ||
      days < 0 ||
      days > 365
    )
      throw new BadRequestException(
        'Set an expiry warning period from 0 to 365 days',
      );
    const revision = revisionInput(body.revision);
    return this.change(
      req,
      textInput(body.reason, 'reason', 200),
      'business.settings.changed',
      async (client) => {
        const result = await client.query(
          'UPDATE business_setting SET expiry_warning_days = $1, revision = revision + 1 WHERE id AND revision = $2 RETURNING revision',
          [days, revision],
        );
        if (!result.rowCount)
          throw new ConflictException(
            'Settings changed. Reload before saving.',
          );
        return { revision: result.rows[0].revision };
      },
    );
  }

  assignStaff(req: StaffRequest, value: unknown) {
    const body = objectInput(value);
    const userId = textInput(body.userId, 'staff ID', 64);
    const home = uuidInput(body.homeDepartmentId, 'home department');
    const cover = body.coverDepartmentId
      ? uuidInput(body.coverDepartmentId, 'cover department')
      : null;
    if (home === cover)
      throw new BadRequestException('Choose a different department for cover');
    let expiry: string | null = null;
    if (cover) {
      if (
        typeof body.coverExpiresAt !== 'string' ||
        !Number.isFinite(Date.parse(body.coverExpiresAt))
      )
        throw new BadRequestException('Provide the cover expiry time');
      expiry = new Date(body.coverExpiresAt).toISOString();
      if (Date.parse(expiry) <= Date.now())
        throw new BadRequestException('Cover must expire in the future');
    }
    return this.change(
      req,
      textInput(body.reason, 'reason', 200),
      'business.staff.access.changed',
      async (client) => {
        const staff = await client.query(
          'SELECT id FROM "user" WHERE id = $1 AND NOT disabled AND archived_at IS NULL FOR UPDATE',
          [userId],
        );
        if (!staff.rowCount)
          throw new BadRequestException('Staff account unavailable');
        const ids = cover ? [home, cover] : [home];
        const departments = await client.query(
          'SELECT d.id FROM business_department d JOIN business_branch b ON b.id = d.branch_id WHERE d.id = ANY($1::uuid[]) AND d.active AND b.active FOR SHARE OF d, b',
          [ids],
        );
        if (departments.rowCount !== ids.length)
          throw new BadRequestException('Department unavailable');
        const open = await client.query(
          "SELECT id FROM cash_shift WHERE cashier_id = $1 AND status = 'open'",
          [userId],
        );
        if (open.rowCount)
          throw new ConflictException(
            'Close the staff member’s shift before changing access',
          );
        await client.query(
          'DELETE FROM staff_department_access WHERE user_id = $1',
          [userId],
        );
        await client.query(
          'INSERT INTO staff_department_access(user_id, department_id, home) VALUES ($1, $2, true)',
          [userId, home],
        );
        if (cover)
          await client.query(
            'INSERT INTO staff_department_access(user_id, department_id, expires_at) VALUES ($1, $2, $3)',
            [userId, cover, expiry],
          );
        return {
          userId,
          homeDepartmentId: home,
          coverDepartmentId: cover,
          coverExpiresAt: expiry,
        };
      },
    );
  }

  assignProduct(req: StaffRequest, value: unknown) {
    const body = objectInput(value);
    const id = uuidInput(body.productId, 'product');
    const departmentId = uuidInput(body.departmentId, 'department');
    const revision = revisionInput(body.revision);
    const reason = textInput(body.reason, 'reason', 200);
    if (reason.length < 3)
      throw new BadRequestException(
        'Provide a reason of at least three characters',
      );
    return this.change(
      req,
      reason,
      'business.product.assigned',
      async (client) => {
        const department = await client.query(
          'SELECT d.id FROM business_department d JOIN business_branch b ON b.id = d.branch_id WHERE d.id = $1 AND d.active AND b.active FOR SHARE OF d, b',
          [departmentId],
        );
        if (!department.rowCount)
          throw new BadRequestException('Department unavailable');
        const updated = await client.query(
          'UPDATE catalogue_product SET department_id = $1, revision = revision + 1, updated_at = now() WHERE id = $2 AND revision = $3 AND department_id IS NULL RETURNING id',
          [departmentId, id, revision],
        );
        if (!updated.rowCount)
          throw new ConflictException(
            'Product changed or already has a department. Reload before assigning.',
          );
        const product = await readProduct(client, id);
        await recordHistory(
          client,
          { userId: req.staff.user.id, sessionId: req.staff.session.id },
          reason,
          'product',
          product,
        );
        return { productId: id, departmentId };
      },
    );
  }
}
