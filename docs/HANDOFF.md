# Pay & Go handoff

**Updated:** 15 September 2026

**Current phase:** Local email/password authentication and staff-access foundation implemented. User confirmed controlled accounts, no public signup, centered shadcn UI, and verification/recovery/MFA as pre-live follow-ups. Deployment remains deferred.

Read root/scoped AGENTS and the architecture before changes. Reinspect Git and source; this is a snapshot.

## Implemented and locally verified

- React/Vite frontend and NestJS/pg backend remain separate pnpm projects in one root repository. Better Auth is pinned directly to 1.7.4 in both; existing Nest wrapper resolves to 2.8.0.
- Identity module: Better Auth raw-body handling, validated secret/origin, PostgreSQL sessions, generic error logs, explicit Origin checks for auth writes, database login rate limits, and blocked signup/profile mutation endpoints.
- Global application guard protects Nest routes by default, validates manager/cashier roles from fresh server session data and returns generic errors. Public root/health routes bypass session lookup. No cookie cache. /api/identity/me returns only required profile fields; /api/identity/manager-access is a permission proof, not a report.
- New sessions capped at eight hours, including non-remembered sessions (1.7.4 otherwise uses 24 hours for these). UI uses nonpersistent browser cookies; active sessions may refresh. This is not inactivity locking.
- SQL migration 202609150001_identity.sql adds user, session, account, verification, rateLimit and provisioning audit tables. Existing app_metadata remains. Explicit runner only; no startup schema mutation.
- Local staff command validates input, hashes with Better Auth and atomically creates user/account/audit rows. No public or hosted provisioning endpoint; command refuses remote/production databases and rejects duplicate emails.
- Frontend: generated Base UI shadcn input/label/card, centered responsive sign-in, protected profile shell, pending/error/retry/logout handling, session rechecks on focus/reconnect and every minute. No fake checkout/reports. Removed the global d theme shortcut.
- Local Vite binds localhost:5173 and proxies /api to 127.0.0.1:3000. No wildcard CORS or browser secrets.

## Local state and getting started

See [local auth setup](LOCAL_AUTH_SETUP.md) for exact commands and private staff-file format.

- PostgreSQL 18.6 service remains available at 127.0.0.1:5432; dedicated pay_and_go_dev/pay_and_go_test databases retain separate restricted owners.
- Ran pnpm run auth:setup: appended only missing auth secret/origin to ignored backend/.env; preserved existing database values and printed no secret.
- Ran pnpm run db:migrate against local development: identity migration succeeded. Real test suites create/drop uniquely named schemas in the explicit _test database.
- No persistent development staff account has been created. User should create private backend/.local/staff.env, run pnpm run auth:provision, then remove that plaintext credential file.
- Start backend with pnpm run start:dev and frontend with pnpm run dev. Open http://localhost:5173.
- Temporary API/Vite preview processes were stopped. PostgreSQL is intentionally left running.
- Ignore old release ZIPs: they predate authentication and cannot represent the current app.

## Verification evidence

- Backend pnpm run test: 26 unit/wrapper tests passed.
- Backend pnpm run test:e2e: 5 HTTP/health tests passed, including public health when auth lookup would fail and a sanitized, fail-closed 503 on protected routes.
- node --env-file=.env.test node_modules/vitest/vitest.mjs run --config vitest.config.integration.ts: 7 real PostgreSQL tests passed (6 identity scenarios + migration up/repeat/down/reapply). Includes schema matching, atomic duplicate rejection, password hashing/login, roles, logout invalidation, expiry, role revocation, signup/role mutation denial, missing/untrusted Origin denial and rate limiting despite spoofed IP headers.
- Backend TypeScript, lint and production build passed.
- Frontend tests: 11 passed across login form, access shell and API-response validation. Frontend lint, referenced-project TypeScript production build and peer dependency checks passed.
- Early concurrent runs hit unit/UI timeouts under machine load; reruns passed without relaxing assertions or timeouts. The first untrusted-Origin test also exposed actual library behavior; added an explicit origin check and the regression now passes.
- Browser: actual local Nest/Vite login rendered in headless Edge. Explicit viewport emulation verified 390px dark and 1365px light, with document width equal to viewport width. Screenshots inspected; no clipping. Browser check covered signed-out layout, not a complete interactive login. Real credential/session behavior is covered by HTTP integration tests.
- Screenshots and browser scratch material are ignored under .local/identity-browser/. Earlier narrow command-line screenshots were cropped by the browser viewport and are not the verification evidence; use phone-dark.png and desktop-light-verified.png.
- No hosting, live trading, real payments, fiscal invoices, phone-over-mobile-data or backup restore verified by this task.

## Decisions and security follow-ups

- Used installed Better Auth setup, security, create-auth and email/password skills. Official llms.txt maps 1.7.x to current 1.7 docs; reviewed installed types/schema/source rather than copying snippets or running an unpinned auth migrator.
- No Redis, ORM, social login, multi-tenancy, paid service or real email delivery added.
- Rate limiting currently uses the actual socket IP, overwriting client headers. Behind local Vite all clients share a loopback limit. Hosted proxy trust/IP attribution requires separate review before deployment.
- Email verification, password recovery, manager MFA, account disable/reset/admin UI, complete auth audit and inactivity locking remain incomplete. Provisioning audit uses an operator-supplied label, not an authenticated admin identity.
- Manager/cashier role checks are a foundation; future features need action-specific permissions, branch/till scope and CSRF checks for business writes. No catalogue, sales, inventory, shifts, dashboard or integrations implemented.

## Next work

1. User provisions a local manager and cashier using LOCAL_AUTH_SETUP.md, then tries the screen.
2. Implement catalogue with reviewed product/category/barcode migrations, runtime validation, manager-only writes and authenticated reads; build matching shadcn screens and tests. Confirm product fields/units before CSV import.
3. Implement one atomic cash-sale/stock/audit/receipt workflow with exact arithmetic and idempotency.
4. Complete auth hardening follow-ups before live use. Resume hosting only when user requests it.

## Deferred hosting and recovery material

HostPinnacle remains the proposed hosting target; user URL is https://dev.sifulabs.co.ke/. Panel runs named package.json scripts with optional parameters, not arbitrary shell commands. Node 22.23.2 basic diagnostic succeeded; pnpm installation failed with allocation errors under a reported 4 GiB address-space limit. Later panel error: "Can't acquire lock for app: dev". Active process versus stale lock remains unknown; no remote process was stopped or lock cleared.

Preserve app.cjs, the packaging script and [deployment runbook](HOSTPINNACLE_DEPLOYMENT.md). Do not rerun deployment scripts during local feature work. On resumption, resolve the lock/install problem and revalidate current auth configuration, runtime, HTTPS, hosted PostgreSQL, proxy trust, mobile access and backup/restore. Prior Node 22 production-only smoke tests covered the pre-auth baseline only.

## Git and private material

Task began after user commit 96f9224 (Deployment is deferred). Authentication code, generated shadcn components, dependency/lockfile changes and documentation are intentional uncommitted work. No commit, push or history rewrite. Existing backend/package-lock.json left untouched; pnpm lockfiles remain authoritative.

Private .env/.env.test, local PostgreSQL credentials, browser profiles, archives and release files remain ignored. Original starter histories remain in .local/git-history/frontend.git (43c34d4) and backend.git (015a5c5); never restore nested repositories. skills-lock.json is tracked; ignored .agents/skills must be restored separately on a clone.

At handoff, review git diff --check and git status --short, including untracked files. Never record secrets or treat plans as implemented features.
