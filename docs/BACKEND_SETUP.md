# Backend foundation setup

Run commands from `backend/`. Use `pnpm.cmd` on Windows if PowerShell blocks `pnpm`.

## Prerequisites and configuration

Use Node.js 24 for the currently tested local setup and `pnpm install --frozen-lockfile`. HostPinnacle's available runtime is still unverified. The pure-JavaScript `pg` driver and `node-pg-migrate` are MIT-licensed; no ORM, native PostgreSQL extension, Docker or paid service is required by the application.

Create a separate development PostgreSQL database and dedicated non-superuser account using your database administrator or hosting panel. Do not reuse a live shop database. Copy `.env.example` to `.env` using your editor, then enter the development connection details privately. No database/user is created by application startup.

| Setting | Behavior |
| --- | --- |
| `NODE_ENV` | `development` (default), `test`, or `production` |
| `PORT` | Integer 1–65535; default 3000 |
| `DATABASE_URL` | Required `postgresql://user:password@host:5432/database`; percent-encode special characters in credentials; no query parameters/fragments |
| `DATABASE_TLS` | `verify` by default; `disable` allowed only for localhost/loopback |
| `DATABASE_POOL_MAX` | Integer 1–20; default 5 per API process; fit total process count to hosting limits |

The API and migration command load `.env` from the working directory; existing process variables take precedence. Use server-side environment settings in hosting. Never use `VITE_*` for credentials. Remote TLS uses certificate verification, never `rejectUnauthorized: false`. If the provider uses a private CA, configure Node's `NODE_EXTRA_CA_CERTS` with the trusted provider CA before starting Node; do not weaken verification. Verify the provider's actual database hostname and TLS support first.

URL query options are disallowed to prevent them from overriding the explicit TLS configuration. See [node-postgres TLS configuration](https://node-postgres.com/features/ssl).

## Run and check

```sh
pnpm run build
pnpm run start:prod
```

| Endpoint | Meaning |
| --- | --- |
| `GET /api/health/live` | 200 means the API responds; no database query |
| `GET /api/health/ready` | 200 after `SELECT 1`; 503 if the database cannot answer |

Both endpoints use `Cache-Control: no-store` and expose no credentials/server details. Readiness proves connectivity only, not applied migrations, permissions for future writes, backups or POS readiness. The starter `/` route remains for now. Stop the process with Ctrl+C; shutdown closes the pool. Database outages do not prevent liveness. Invalid configuration prevents startup.

## Versioned migrations

```sh
pnpm run db:migrate
```

This builds and applies pending SQL files from `backend/migrations/` using `node-pg-migrate`, ordered history in `public.pgmigrations`, an advisory lock and a single transaction. It does not run on API startup. The first migration creates `public.app_metadata` with one application marker; it creates no products, users or sales. The dedicated migration user needs permission to create tables in the dedicated database's public schema. Future application queries must be parameterized and transactions must use one checked-out client.

Before any hosted migration, review the SQL and target privately, take a restorable backup, and confirm the database is isolated. Deploy `migrations/` alongside `dist/`, `package.json`, the lockfile and production dependencies; `dist/` alone is insufficient. If builds are unavailable on hosting, build locally and run `node dist/database/migrate.js up` from the deployed backend directory.

For a disposable, non-production database only:

```sh
pnpm run db:rollback --confirm-rollback
```

This rolls back **one latest migration**. The initial rollback drops `app_metadata` and its contents. It refuses `NODE_ENV=production` or a missing confirmation flag; this is a guard, not a substitute for checking the target database. Prefer reviewed forward migrations for live recovery. Never edit an already-applied migration. See the [migration runner API](https://salsita.github.io/node-pg-migrate/api).

## Automated verification

```sh
pnpm run lint
pnpm exec tsc --noEmit --incremental false
pnpm run test
pnpm run test:e2e
pnpm run build
```

Unit and HTTP tests use fake configuration and mocked database access; they need no credentials and do not prove PostgreSQL connectivity.

For real migration verification, create a **dedicated disposable database with a name ending in `_test`**, with a user permitted to create schemas. Set `TEST_DATABASE_URL` and `TEST_DATABASE_TLS` privately in your terminal environment, then run:

```sh
pnpm run test:integration
```

This test intentionally does not read `.env` or fall back to `DATABASE_URL`. Missing/unsafe test configuration fails the test rather than reporting a skipped pass. It creates a random schema, tests migration up, repeated up, down and reapplication, then drops only that schema and closes the client. An interrupted test may leave an `integration_*` schema; inspect ownership before manual cleanup. Do not use real customer records even in a database with a `_test` suffix.

## Verified local environment

Local PostgreSQL server 18.6 is running at `127.0.0.1:5432` as Windows service `postgresql-x64-18`. Two new databases were provisioned with separate, randomly generated credentials:

| Database | Owner | Local configuration |
| --- | --- | --- |
| `pay_and_go_dev` | `pay_and_go_dev` | `backend/.env` |
| `pay_and_go_test` | `pay_and_go_test` | `backend/.env.test` |

Both owners are non-superusers without role/database creation, replication or RLS-bypass privileges. Each database has public access revoked, and cross-database CONNECT permission was checked as denied. These are local development owners allowed to manage their own schema, not a final production runtime/migration privilege design. Provisioning used the PostgreSQL [role](https://www.postgresql.org/docs/18/sql-createrole.html) and [database](https://www.postgresql.org/docs/18/sql-createdatabase.html) facilities. Existing databases were not modified.

The environment files are Git-ignored and must remain private. The temporary administrator credential file was deleted after provisioning. Do not recreate it for normal development; the application now uses its own account. `.local/` directories at every depth are ignored.

To explicitly load the local test credentials, run from `backend/`:

```sh
node --env-file=.env.test node_modules/vitest/vitest.mjs run --config vitest.config.integration.ts
```

This invokes the same suite as `pnpm run test:integration`, with the test file explicitly loaded by Node. The test itself still never reads the application `.env` or falls back to `DATABASE_URL`. The local `.env.test` contains only `TEST_DATABASE_URL` and `TEST_DATABASE_TLS`.

Verified: migration up/repeated up/down/reapply against the isolated test schema; cleanup with no leftover test schemas; development migration and transactional rollback; compiled API liveness/readiness returning HTTP 200 with no-store headers. The smoke-test API process was stopped. The PostgreSQL service remains running for development.

The next gate is the hosted compatibility, backup/restore and phone-access proof in the architecture plan. Local success does not establish HostPinnacle compatibility or production readiness.
