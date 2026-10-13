import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import { parseEnvironment } from '../src/config/environment.js';
import { databaseOptions } from '../src/database/database.options.js';
import { DatabaseService } from '../src/database/database.service.js';
import { StaffAdminService } from '../src/identity/staff-admin.service.js';
import { AUTH } from '../src/identity/auth.js';
import { AUTH_CONFIG } from '../src/identity/auth.config.js';
import type { StaffRequest } from '../src/identity/staff.guard.js';

describe('staff removal on disposable PostgreSQL', () => {
  let pool: Pool, service: StaffAdminService;
  const schema = `staff_removal_${randomUUID().replaceAll('-', '')}`;
  const manager = randomUUID(),
    session = randomUUID(),
    target = randomUUID();
  const request = {
    headers: {},
    staff: { user: { id: manager }, session: { id: session } },
  } as StaffRequest;
  const confirm = {
    password: 'test-only-confirm-password',
    reason: 'Staff member left the shop',
  };
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Explicit _test database required');
    const config = parseEnvironment({
      DATABASE_URL: url,
      DATABASE_TLS: process.env.TEST_DATABASE_TLS ?? 'verify',
      NODE_ENV: 'test',
    });
    pool = new Pool({
      ...databaseOptions(config),
      options: `-c search_path=${schema}`,
    });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const client = await pool.connect();
    try {
      await runner({
        dbClient: client,
        dir: fileURLToPath(new URL('../migrations/', import.meta.url)),
        schema,
        migrationsSchema: schema,
        migrationsTable: 'pgmigrations',
        direction: 'up',
        singleTransaction: true,
        log: () => undefined,
      });
    } finally {
      client.release();
    }
    await pool.query(
      'INSERT INTO "user" (id,name,email,role,"emailVerified","twoFactorEnabled") VALUES ($1,$2,$3,$4,true,true),($5,$6,$7,$8,true,false)',
      [
        manager,
        'Manager',
        'manager@example.test',
        'manager',
        target,
        'Cashier',
        'cashier@example.test',
        'cashier',
      ],
    );
    await pool.query(
      'INSERT INTO session (id,"userId",token,"expiresAt","mfaVerified") VALUES ($1,$2,$3,now()+interval \'1 hour\',true),($4,$5,$6,now()+interval \'1 hour\',false)',
      [session, manager, randomUUID(), randomUUID(), target, randomUUID()],
    );
    await pool.query(
      'INSERT INTO sale (id,actor_id,total_minor,status,reason) VALUES ($1,$2,0,$3,$4)',
      [randomUUID(), target, 'completed', 'Preserved sale history'],
    );
    const fixture = await Test.createTestingModule({
      providers: [
        StaffAdminService,
        { provide: DatabaseService, useValue: { connectionPool: pool } },
        {
          provide: AUTH,
          useValue: {
            api: {
              verifyPassword: vi.fn().mockResolvedValue({ status: true }),
            },
          },
        },
        { provide: AUTH_CONFIG, useValue: { smtp: null } },
      ],
    }).compile();
    service = fixture.get(StaffAdminService);
  });
  afterAll(async () => {
    if (pool) {
      try {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await pool.end();
      }
    }
  });
  it('denies self-removal, stale revisions and a manager session without MFA', async () => {
    await expect(
      service.action(request, manager, 'archive', { ...confirm, revision: 1 }),
    ).rejects.toThrow('own account');
    await expect(
      service.action(request, target, 'archive', { ...confirm, revision: 99 }),
    ).rejects.toThrow('changed');
    await pool.query('UPDATE session SET "mfaVerified"=false WHERE id=$1', [
      session,
    ]);
    try {
      await expect(
        service.action(request, target, 'archive', { ...confirm, revision: 1 }),
      ).rejects.toThrow('Manager access');
    } finally {
      await pool.query('UPDATE session SET "mfaVerified"=true WHERE id=$1', [
        session,
      ]);
    }
    expect(
      (await pool.query('SELECT archived_at FROM "user" WHERE id=$1', [target]))
        .rows[0].archived_at,
    ).toBeNull();
  });
  it('removes access while retaining sales and audits, then restores as suspended', async () => {
    await pool.query(
      'INSERT INTO auth_mail_outbox (id,user_id,payload) VALUES ($1,$2,$3)',
      [randomUUID(), target, 'opaque-test-ciphertext'],
    );
    await service.action(request, target, 'archive', {
      ...confirm,
      revision: 1,
    });
    const row = (
      await pool.query(
        'SELECT disabled,archived_at,revision FROM "user" WHERE id=$1',
        [target],
      )
    ).rows[0];
    expect(row.disabled).toBe(true);
    expect(row.archived_at).not.toBeNull();
    expect(
      (
        await pool.query(
          'SELECT status,payload FROM auth_mail_outbox WHERE user_id=$1',
          [target],
        )
      ).rows[0],
    ).toEqual({ status: 'failed', payload: null });
    expect(
      (await service.list('', 0)).staff.some((staff) => staff.id === target),
    ).toBe(false);
    expect(
      (await service.list('', 0, 'removed')).staff.map((staff) => staff.id),
    ).toEqual([target]);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM session WHERE "userId"=$1',
          [target],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (await pool.query('SELECT actor_id FROM sale')).rows[0].actor_id,
    ).toBe(target);
    await expect(
      pool.query('UPDATE "user" SET disabled=false WHERE id=$1', [target]),
    ).rejects.toThrow('removed_staff_disabled');
    await expect(
      service.update(request, target, {
        ...confirm,
        name: 'Cashier',
        role: 'cashier',
        disabled: false,
        revision: row.revision,
      }),
    ).rejects.toThrow('Restore');
    await service.action(request, target, 'restore', {
      ...confirm,
      revision: row.revision,
    });
    const restored = (
      await pool.query('SELECT disabled,archived_at FROM "user" WHERE id=$1', [
        target,
      ])
    ).rows[0];
    expect(restored).toEqual({ disabled: true, archived_at: null });
    expect(
      (await service.list('', 0, 'suspended')).staff.map((staff) => staff.id),
    ).toEqual([target]);
    const audit = await pool.query(
      "SELECT action FROM auth_audit WHERE subject_id=$1 AND action IN ('staff.removed','staff.restored') ORDER BY id",
      [target],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'staff.removed',
      'staff.restored',
    ]);
  });
});
