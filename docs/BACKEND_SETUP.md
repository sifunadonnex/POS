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

The real PostgreSQL test has not yet been run against a database in this workspace. The next gate is running it and checking both health endpoints against the isolated development database, followed by the hosted compatibility/backup/phone-access proof in the architecture plan.
