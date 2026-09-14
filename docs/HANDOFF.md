# Pay & Go handoff

**Updated:** 14 September 2026

**Current phase:** Backend foundation verified against local PostgreSQL 18.6. Hosted compatibility, backup/restore and phone-access proof remain pending. No POS business workflows yet.

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
- Local `pay_and_go_dev` and `pay_and_go_test` databases now exist with separate non-superuser owners of the same names and random credentials in ignored `backend/.env` and `backend/.env.test`. Development migration applied; test schema cleaned up. Public database access revoked; cross-database CONNECT denied. These local schema owners are not the final production privilege design.
- No authentication, catalogue, inventory, checkout, manager reports, M-Pesa/eTIMS integration or deployment.

See [backend setup](BACKEND_SETUP.md) for environment settings, exact commands, migration impact and required deployment assets. Readiness proves connectivity only, not applied migrations, backups or POS readiness.

## Latest changes and verification

Added pg 8.23.0, node-pg-migrate 9.0.0 and @types/pg 8.23.1, with pnpm lockfile updates. Driver/migrator are MIT-licensed; no native driver or paid service added. Added modules, tests, SQL, .env.example, setup guide and architecture ADR-012. Updated recurring rules.

Local tools observed: Node.js 24.15.0, pnpm 11.10.0, authenticated PostgreSQL server 18.6; hosting versions are not confirmed.

- Backend build passed.
- Unit tests passed: 17 tests across 3 files.
- HTTP tests passed: 4 tests, including failure sanitization and database-independent liveness.
- Backend lint passed; pnpm peer check reported no issues.
- Full source/test TypeScript check exposed an existing Supertest import missing the NodeNext .js suffix; corrected and rechecked.
- Changed source/configuration formatted; final formatting, diff and status reviewed.
- Real PostgreSQL integration test passed: 1 test verifying up, idempotent up, down and reapply in a temporary schema. Run from backend: `node --env-file=.env.test node_modules/vitest/vitest.mjs run --config vitest.config.integration.ts`. Confirmed no leftover integration schemas or public application table in the test database.
- `pnpm run db:migrate` built the backend and applied the development migration. Repeating `node dist/database/migrate.js up` succeeded. Verified the application marker and a parameterized insert rolled back without leaving its probe row.
- Started compiled `dist/main.js` on a temporary port: live and ready both returned HTTP 200 with expected bodies and no-store headers against the real development database. Child process stopped afterward.
- Provisioned only two new application databases/roles; no pre-existing database or old PostgreSQL data directory modified. Verified application logins, no superuser/role-creation/database-creation/replication/RLS-bypass privileges, and no cross-database CONNECT permission.
- Frontend lint/typecheck/build passed in the previous session; not rerun for this backend-only change.
- No browser review or deployment. No API process remains running; the existing Windows PostgreSQL service `postgresql-x64-18` remains running at 127.0.0.1:5432 for development.

The real integration test does not load .env or fall back to DATABASE_URL. Missing dedicated test settings cause failure, not a skipped pass. Its 30-second timeout is specific to real migration work. The previous starter setup timeout did not reproduce and its original cause remains unproven.

## Git state

Latest user commit is `fd80e15` (added Better Auth and skills); previous foundation changes are committed. At this session's start, docs/HANDOFF.md was already modified and backend/package-lock.json was untracked. The npm lockfile is user work and was left untouched; the agreed package manager remains pnpm. This session changes ignore rules, root rules and setup/architecture/handoff documentation. No commit, push or history rewrite performed.

The user placed the temporary administrator credential in backend/.local/. Changed the root-only .local ignore rule to cover every depth before reading it. Consumed the credential without printing it, then deleted the administrator file and temporary provisioning/verification scripts. Only private application credentials remain in ignored backend/.env and backend/.env.test; never stage or print them.

Original histories remain in ignored local archives: .local/git-history/frontend.git (HEAD 43c34d4) and .local/git-history/backend.git (HEAD 015a5c5). They are not included in clones/remotes; never restore nested repositories.

The user confirmed adding authentication skills. Root skills-lock.json records six skills from better-auth/skills and is now committed. Skill files are locally available under the ignored .agents/skills directory, so a clone does not automatically contain them. Restore the required skills before authentication work; do not assume the lockfile alone installs them.

The user-added @thallesp/nestjs-better-auth resolves to 2.8.0 and its Better Auth peer resolves to 1.7.4 in the backend lockfile. Better Auth itself is not yet a direct backend dependency; explicitly declare it when application code imports it. The wrapper has not been integrated. The official NestJS documentation inspected shows Better Auth 1.7.4 and calls the wrapper community-maintained. The llms.txt index could not be retrieved by the web reader (unsupported content type); retry version-index discovery at implementation time rather than assuming future latest docs match.

This session provisioned local PostgreSQL and reran lint, full source/test type-check, build, unit and HTTP tests successfully, plus real migration/API verification. No application source or dependency changes made. Whitespace and Git status checked. Better Auth skills apply when authentication work begins; none was implemented in this database-only step.

## Next work, in order

1. With secure hosting access and an owned test domain, prove HostPinnacle versions, startup/HTTPS, database TLS/migrations, restart/logs, resource limits, backup/restore and phone access. Deploy migrations/ as well as dist/. Do not disturb existing sites. The local database gate has passed; this hosted gate has not.
2. Once foundation gates pass, implement Better Auth/server sessions and POS permissions using the setup/security skills and version-matched docs. Read email/password and MFA skills for those flows; use the organization skill only if that plugin is deliberately selected. Verify wrapper body parsing, public health routes, protected endpoints, cookies/CSRF, trusted origins, throttling and session revocation. Keep auth schema changes in reviewed migrations. Then implement catalogue and the first complete cash-sale path with atomic inventory/audit writes, receipt/reprint and manager reporting.

## Open items

- User supplied test URL `https://dev.sifulabs.co.ke/` and a Create Application screenshot showing Node.js 22.23.2 (recommended), application mode/root/URL/startup fields and a Passenger log field. Select Node 22.23.2 for the proposed hosted proof; local testing so far used Node 24.15.0, so Node 22 execution remains unverified. Nest core and node-pg-migrate declared engine ranges allow this candidate.
- Proposed separate application root: `pay-and-go-dev` outside the public document root; confirm it is unused before creation. Production application mode is appropriate for the isolated hosted test, not a claim of live POS readiness. An ESM-compatible CommonJS startup wrapper needs preparation/testing before upload: [CloudLinux documents this Passenger limitation](https://docs.cloudlinux.com/cloudlinuxos/cloudlinux_os_components/#limitations). Do not assume direct Passenger loading of dist/main.js works.
- Test URL could not be reached by either the web reader or a local HTTPS HEAD request during inspection. This does not establish a DNS/certificate/server diagnosis; HTTPS/routing still need verification. No hosting changes or uploads made.
- Terminal/SSH availability, exact package limits, hosted PostgreSQL version/TLS, secure access and backup/restore arrangements remain unresolved. Local PostgreSQL setup is complete, not a hosted compatibility or recovery guarantee.
- Confirm simulated versus real trading, Kenya jurisdiction, M-Pesa/eTIMS workflows, weighted goods and offline launch requirements.
- Review the starter theme provider's global d shortcut before cashier/scanner input.
- External Observe telemetry and generic Nest deployment helper remain removed; do not reintroduce without a project decision.

Replace stale status after meaningful work. Keep durable decisions in the architecture document, conventions in AGENTS files and implementation/test evidence here. Never record secrets or unsupported completion claims.
