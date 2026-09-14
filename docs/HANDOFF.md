# Pay & Go handoff

**Updated:** 14 September 2026

**Current phase:** Backend configuration, health and migration foundation implemented. Real PostgreSQL and hosted verification remain pending. No POS business workflows yet.

Read root/scoped AGENTS files and the architecture plan first. Reinspect source and Git status; this is a snapshot.

## Settled direction

- One root Git repository; React/Vite frontend, NestJS backend, separate pnpm lockfiles.
- Strict shadcn/ui with the existing Base UI preset, Tailwind tokens and Lucide icons.
- PostgreSQL through `pg`, explicit versioned SQL through `node-pg-migrate`; no ORM or startup schema synchronization.
- Better Auth is now explicitly user-selected. Read the relevant installed authentication skills and version-matched official documentation before auth implementation; retain shadcn UI and server-side POS permissions.
- Reuse HostPinnacle for the online test, preferably one frontend/API origin. User reports Node.js and PostgreSQL management in the panel; deployment compatibility is unverified.
- No extra hosting subscription, Vercel subscription, phone VPN or offline checkout claims.

## Current implementation

- Frontend remains the React 19/Vite 8/TypeScript 6 starter with shadcn Button and theme provider. No business screens.
- Backend remains NestJS 12/TypeScript 6, ESM/NodeNext; starter `/` retained.
- `src/config/`: optional backend .env loading, required validated database URL, port/pool bounds, verified remote TLS.
- `src/database/`: bounded pg pool, connectivity probe, shutdown cleanup and explicit migration runner.
- `/api/health/live` checks API responsiveness without querying the database.
- `/api/health/ready` checks SELECT 1 and returns a generic 503 on failure. Both endpoints use no-store headers.
- Initial SQL migration creates an app_metadata marker, not products/users/sales. Runner uses history, advisory locking and a transaction. One-step rollback requires non-production mode and explicit confirmation.
- Unit/HTTP tests use fake configuration and mocked database access. Separate integration test requires an explicit disposable database ending in _test, uses a random schema, checks up/repeated up/down/reapply and cleans up that schema.
- No authentication, catalogue, inventory, checkout, manager reports, M-Pesa/eTIMS integration or deployment.

See [backend setup](BACKEND_SETUP.md) for environment settings, exact commands, migration impact and required deployment assets. Readiness proves connectivity only, not applied migrations, backups or POS readiness.

## Latest changes and verification

Added pg 8.23.0, node-pg-migrate 9.0.0 and @types/pg 8.23.1, with pnpm lockfile updates. Driver/migrator are MIT-licensed; no native driver or paid service added. Added modules, tests, SQL, .env.example, setup guide and architecture ADR-012. Updated recurring rules.

Local tools observed: Node.js 24.15.0, pnpm 11.10.0; hosting versions are not confirmed.

- Backend build passed.
- Unit tests passed: 17 tests across 3 files.
- HTTP tests passed: 4 tests, including failure sanitization and database-independent liveness.
- Backend lint passed; pnpm peer check reported no issues.
- Full source/test TypeScript check exposed an existing Supertest import missing the NodeNext .js suffix; corrected and rechecked.
- Changed source/configuration formatted; final formatting, diff and status reviewed.
- Real PostgreSQL migration verification remains **not run**. No psql/Docker command or PostgreSQL/Docker Windows service was found. No database credentials were supplied or read.
- Frontend lint/typecheck/build passed in the previous session; not rerun for this backend-only change.
- No browser review, deployment or development server started this session.

The real integration test does not load .env or fall back to DATABASE_URL. Missing dedicated test settings cause failure, not a skipped pass. Its 30-second timeout is specific to real migration work. The previous starter setup timeout did not reproduce and its original cause remains unproven.

## Git state

Clean at start after user commit `9107ccb` (baseline fixes), following `3186aaa` (initial scaffold). Current backend, lockfile, rules and documentation edits are intentional and uncommitted. No commit, push or history rewrite performed. Include new modules, tests, SQL and .env.example when reviewing explicit paths for a future commit.

Original histories remain in ignored local archives: .local/git-history/frontend.git (HEAD 43c34d4) and .local/git-history/backend.git (HEAD 015a5c5). They are not included in clones/remotes; never restore nested repositories.

The user confirmed adding authentication skills. The inspected root skills-lock.json records six skills from better-auth/skills; it remains unchanged and untracked. Skill files are locally available under the ignored .agents/skills directory, so a clone does not automatically contain them. Restore the required skills before authentication work; do not assume the lockfile alone installs them.

The user-added @thallesp/nestjs-better-auth resolves to 2.8.0 and its Better Auth peer resolves to 1.7.4 in the backend lockfile. Better Auth itself is not yet a direct backend dependency; explicitly declare it when application code imports it. The wrapper has not been integrated. The official NestJS documentation inspected shows Better Auth 1.7.4 and calls the wrapper community-maintained. The llms.txt index could not be retrieved by the web reader (unsupported content type); retry version-index discovery at implementation time rather than assuming future latest docs match.

Latest follow-up was documentation-only: read the setup/security skills, checked official NestJS documentation, and recorded ADR-013 and recurring skill/version-check rules. No packages or runtime code changed in that follow-up; existing test results above belong to the foundation implementation. Whitespace and Git status checked; no commit made.

## Next work, in order

1. Provision separate development and disposable test PostgreSQL databases/users. Privately configure backend .env and TEST_DATABASE_URL/TEST_DATABASE_TLS following the setup guide. Run `pnpm run test:integration`, apply the development migration, and verify both health endpoints against the real database. Record actual results and resolve incompatibilities before business features.
2. With secure hosting access and an owned test domain, prove HostPinnacle versions, startup/HTTPS, database TLS/migrations, restart/logs, resource limits, backup/restore and phone access. Deploy migrations/ as well as dist/. Do not disturb existing sites.
3. Once foundation gates pass, implement Better Auth/server sessions and POS permissions using the setup/security skills and version-matched docs. Read email/password and MFA skills for those flows; use the organization skill only if that plugin is deliberately selected. Verify wrapper body parsing, public health routes, protected endpoints, cookies/CSRF, trusted origins, throttling and session revocation. Keep auth schema changes in reviewed migrations. Then implement catalogue and the first complete cash-sale path with atomic inventory/audit writes, receipt/reprint and manager reporting.

## Open items

- Hosting package/runtime versions, owned domain and secure access unavailable; local PostgreSQL setup and backup/restore arrangements unresolved.
- Confirm simulated versus real trading, Kenya jurisdiction, M-Pesa/eTIMS workflows, weighted goods and offline launch requirements.
- Review the starter theme provider's global d shortcut before cashier/scanner input.
- External Observe telemetry and generic Nest deployment helper remain removed; do not reintroduce without a project decision.

Replace stale status after meaningful work. Keep durable decisions in the architecture document, conventions in AGENTS files and implementation/test evidence here. Never record secrets or unsupported completion claims.
