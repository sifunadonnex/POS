import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import { getMigrations } from 'better-auth/db/migration';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, parseEnvironment } from '../src/config/environment.js';
import { databaseOptions } from '../src/database/database.options.js';
import { DatabaseService } from '../src/database/database.service.js';
import { AUTH_CONFIG } from '../src/identity/auth.config.js';
import { AUTH, type PayGoAuth } from '../src/identity/auth.js';
import {
  parseStaffInput,
  provisionStaff,
} from '../src/identity/provision-staff.js';
import { AUTH_MAILER, type AuthMessage } from '../src/identity/auth-mail.js';
import { cookieHeader, totpCode } from './security-test-helpers.js';

describe('real PostgreSQL staff authentication', () => {
  let pool: Pool;
  let app: INestApplication;
  const schema = `identity_${randomUUID().replaceAll('-', '')}`;
  const origin = 'http://localhost:5173';
  const password = randomBytes(24).toString('base64url');
  let managerId: string;
  let managerSecret = '';
  const emails: AuthMessage[] = [];

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Explicit TEST_DATABASE_URL ending in _test is required');
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
    for (const role of ['manager', 'cashier']) {
      const id = await provisionStaff(
        pool,
        parseStaffInput({
          STAFF_EMAIL: `${role}@example.test`,
          STAFF_NAME: role,
          STAFF_PASSWORD: password,
          STAFF_ROLE: role,
          STAFF_PROVISIONED_BY: 'integration-test',
        }),
      );
      if (role === 'manager') managerId = id;
    }
    // These fixtures isolate session/role behavior; a separate test below exercises email verification.
    await pool.query('UPDATE "user" SET "emailVerified" = true');
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .overrideProvider(AUTH_CONFIG)
      .useValue({
        secret: randomBytes(32).toString('hex'),
        baseURL: origin,
        secureCookies: false,
        smtp: {
          host: 'smtp.example.test',
          port: 587,
          user: 'test',
          password: 'test-only',
          from: 'test@example.test',
        },
      })
      .overrideProvider(AUTH_MAILER)
      .useValue({
        send: async (message: AuthMessage) => {
          emails.push(message);
        },
      })
      .overrideProvider(DatabaseService)
      .useValue({
        connectionPool: pool,
        checkConnection: () => pool.query('SELECT 1'),
      })
      .compile();
    app = fixture.createNestApplication({ bodyParser: false, logger: false });
    await app.init();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM "rateLimit"');
  });
  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      if (pool) {
        try {
          await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await pool.end();
        }
      }
    }
  });

  async function login(role = 'manager') {
    const response = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email: `${role}@example.test`, password, rememberMe: false })
      .expect(200);
    let cookie = cookieHeader(response.headers['set-cookie']);
    expect(String(response.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(response.headers['set-cookie'])).toContain('SameSite=Lax');
    if (role === 'manager') {
      if (!response.body.twoFactorRedirect) {
        const setup = await request(app.getHttpServer())
          .post('/api/auth/two-factor/enable')
          .set('Origin', origin)
          .set('Cookie', cookie)
          .send({ password })
          .expect(200);
        const uri: unknown = setup.body.totpURI;
        if (typeof uri !== 'string')
          throw new Error('Expected authenticator setup');
        managerSecret = new URL(uri).searchParams.get('secret') ?? '';
      }
      const verified = await request(app.getHttpServer())
        .post('/api/auth/two-factor/verify-totp')
        .set('Origin', origin)
        .set('Cookie', cookie)
        .send({ code: totpCode(managerSecret), trustDevice: false })
        .expect(200);
      if (verified.headers['set-cookie'])
        cookie = cookieHeader(verified.headers['set-cookie'], cookie);
    }
    return cookie;
  }

  it('matches the installed auth schema and provisions hashed credentials atomically', async () => {
    const plan = await getMigrations(app.get<PayGoAuth>(AUTH).options);
    expect(plan.toBeCreated).toEqual([]);
    expect(plan.toBeAdded).toEqual([]);
    expect(plan.schemaProblems).toEqual([]);
    expect(plan.unsafeChanges).toEqual([]);
    const rows = await pool.query<{ password: string }>(
      'SELECT password FROM account',
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((row) => row.password !== password)).toBe(true);
    const input = parseStaffInput({
      STAFF_EMAIL: 'manager@example.test',
      STAFF_NAME: 'duplicate',
      STAFF_PASSWORD: password,
      STAFF_ROLE: 'cashier',
      STAFF_PROVISIONED_BY: 'test',
    });
    await expect(provisionStaff(pool, input)).rejects.toThrow(
      'Staff creation failed',
    );
    expect((await pool.query('SELECT * FROM identity_audit')).rowCount).toBe(2);
  });

  it('protects routes, allows health probes and refuses public signup', async () => {
    await request(app.getHttpServer())
      .get('/api/identity/me')
      .expect(401)
      .expect('Cache-Control', 'no-store');
    await request(app.getHttpServer()).get('/api/health/live').expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .set('Origin', origin)
      .send({
        email: 'attack@example.test',
        name: 'Attack',
        password,
        role: 'manager',
        emailVerified: true,
        twoFactorEnabled: true,
        mfaRequired: false,
        idleSeconds: 900,
      })
      .expect(403);
    expect((await pool.query('SELECT * FROM "user"')).rowCount).toBe(2);
  });

  it('logs in, enforces roles and invalidates the cookie on logout', async () => {
    const cookie = await login();
    const expiry = await pool.query<{ expiresAt: Date }>(
      'SELECT "expiresAt" FROM session WHERE "userId" = $1',
      [managerId],
    );
    expect(
      expiry.rows.every(
        (row) => row.expiresAt.getTime() <= Date.now() + 8 * 60 * 60 * 1000,
      ),
    ).toBe(true);
    const me = await request(app.getHttpServer())
      .get('/api/identity/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body).toEqual({
      user: {
        id: managerId,
        name: 'manager',
        email: 'manager@example.test',
        role: 'manager',
        emailVerified: true,
        twoFactorEnabled: true,
        mfaRequired: false,
        idleSeconds: 900,
      },
    });
    await request(app.getHttpServer())
      .get('/api/identity/manager-access')
      .set('Cookie', cookie)
      .expect(200);
    const cashier = await login('cashier');
    await request(app.getHttpServer())
      .get('/api/identity/manager-access')
      .set('Cookie', cashier)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/sign-out')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/identity/me')
      .set('Cookie', cookie)
      .expect(401);
  });

  it('rejects untrusted origins and client role changes', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: 'manager@example.test', password })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', 'https://untrusted.example')
      .send({ email: 'manager@example.test', password })
      .expect(403);
    const cookie = await login('cashier');
    await request(app.getHttpServer())
      .post('/api/auth/update-user')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ role: 'manager' })
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/identity/manager-access')
      .set('Cookie', cookie)
      .expect(403);
  });

  it('observes role revocation and expired sessions without a cookie cache', async () => {
    const cookie = await login();
    try {
      await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', [
        'cashier',
        managerId,
      ]);
      await request(app.getHttpServer())
        .get('/api/identity/manager-access')
        .set('Cookie', cookie)
        .expect(401);
      const expiryCookie = await login('cashier');
      await pool.query(
        'UPDATE session SET "expiresAt" = now() - interval \'1 hour\' WHERE "userId" = $1',
        [
          (
            await pool.query<{ id: string }>(
              'SELECT id FROM "user" WHERE email = $1',
              ['cashier@example.test'],
            )
          ).rows[0].id,
        ],
      );
      await request(app.getHttpServer())
        .get('/api/identity/me')
        .set('Cookie', expiryCookie)
        .expect(401);
    } finally {
      await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', [
        'manager',
        managerId,
      ]);
    }
  });

  it('rate limits wrong passwords despite spoofed client IP headers', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .set('Origin', origin)
        .set('x-paygo-client-ip', `10.0.0.${attempt}`)
        .send({ email: 'manager@example.test', password: 'incorrect-password' })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email: 'manager@example.test', password })
      .expect(429);
  });

  it('requires email verification and consumes password-reset links once while revoking sessions', async () => {
    const email = 'new-staff@example.test';
    const userId = await provisionStaff(
      pool,
      parseStaffInput({
        STAFF_NAME: 'New staff',
        STAFF_EMAIL: email,
        STAFF_PASSWORD: password,
        STAFF_ROLE: 'cashier',
        STAFF_PROVISIONED_BY: 'integration-test',
      }),
    );
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email, password })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/send-verification-email')
      .set('Origin', origin)
      .send({ email })
      .expect(200);
    const verification = emails.findLast(
      (message) => message.userId === userId && message.purpose === 'verify',
    );
    if (!verification) throw new Error('Expected captured verification email');
    await request(app.getHttpServer())
      .get('/api/auth/verify-email')
      .query({ token: verification.token })
      .expect(200);
    const loggedIn = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email, password })
      .expect(200);
    const cookie = cookieHeader(loggedIn.headers['set-cookie']);
    await request(app.getHttpServer())
      .post('/api/auth/request-password-reset')
      .set('Origin', origin)
      .send({ email })
      .expect(200);
    const reset = emails.findLast(
      (message) => message.userId === userId && message.purpose === 'reset',
    );
    if (!reset) throw new Error('Expected captured reset email');
    const newPassword = randomBytes(24).toString('base64url');
    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .set('Origin', origin)
      .send({ token: reset.token, newPassword })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/identity/me')
      .set('Cookie', cookie)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .set('Origin', origin)
      .send({ token: reset.token, newPassword })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email, password })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email, password: newPassword })
      .expect(200);
  });

  it('requires session MFA proof, blocks trust-device bypass and enforces idle expiry', async () => {
    const cookie = await login();
    await pool.query(
      'UPDATE session SET "mfaVerified" = false WHERE "userId" = $1',
      [managerId],
    );
    await request(app.getHttpServer())
      .get('/api/identity/staff')
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/two-factor/enable')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ password })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/two-factor/verify-totp')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ code: totpCode(managerSecret), trustDevice: true })
      .expect(403);
    await pool.query(
      'UPDATE session SET "lastActivityAt" = now() - interval \'16 minutes\' WHERE "userId" = $1',
      [managerId],
    );
    await request(app.getHttpServer())
      .post('/api/identity/activity')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({})
      .expect(401);
  });

  it('protects administration, suspends users atomically, and preserves append-only audit history', async () => {
    const cookie = await login();
    const cashier = await login('cashier');
    const cashierRow = await pool.query<{ id: string; revision: number }>(
      'SELECT id, revision FROM "user" WHERE role = $1 ORDER BY "createdAt" LIMIT 1',
      ['cashier'],
    );
    const target = cashierRow.rows[0];
    await request(app.getHttpServer())
      .post('/api/identity/staff')
      .set('Origin', origin)
      .set('Cookie', cashier)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/identity/staff/${target.id}`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({
        name: 'cashier',
        role: 'cashier',
        disabled: true,
        revision: target.revision,
        reason: 'Test suspension',
        password,
      })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/identity/me')
      .set('Cookie', cashier)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email: 'cashier@example.test', password })
      .expect(401);
    const events = await pool.query<{ action: string; detail: unknown }>(
      'SELECT action, detail FROM auth_audit WHERE subject_id = $1',
      [target.id],
    );
    expect(events.rows.some((event) => event.action === 'staff.updated')).toBe(
      true,
    );
    expect(JSON.stringify(events.rows)).not.toContain(password);
    await expect(
      pool.query('UPDATE auth_audit SET outcome = $1', ['failure']),
    ).rejects.toThrow('append-only');
    await expect(pool.query('DELETE FROM auth_audit')).rejects.toThrow(
      'append-only',
    );
    await request(app.getHttpServer())
      .patch(`/api/identity/staff/${managerId}`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({
        name: 'manager',
        role: 'cashier',
        disabled: false,
        revision: 1,
        reason: 'Test self-demotion',
        password,
      })
      .expect(409);
  });
});
