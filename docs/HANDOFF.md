# Pay & Go handoff

**Updated:** 15 September 2026

**Current phase:** Local feature development. On 15 September 2026 the user deferred deployment troubleshooting. Local PostgreSQL/migration/API checks passed previously; Better Auth login, sessions and server-side permissions are the next milestone, not yet implemented.

## Deferred hosting status

- HostPinnacle remains the target; deployment is not a prerequisite for local features, but must pass before a hosted pilot or live use.
- The panel selects named package.json scripts and optional arguments; it does not accept arbitrary shell commands.
- User-reported hosting:install failed with return code -6 and CodeRange/heap allocation errors. Supplied process address-space limits were 4 GiB; actual account/LVE usage and the failing process remain unknown.
- User-reported hosting:diagnose succeeded on Node 22.23.2 linux x64: RSS 55,652,352 bytes and V8 heap limit 4,345,298,944 bytes. This establishes basic Node startup, not successful dependency installation or application startup.
- After reporting a script still running, the user received "Can't acquire lock for app: dev". An active operation or stale management lock is possible; neither is confirmed. No remote process was stopped or lock cleared by us.
- Preserve the [deployment runbook](HOSTPINNACLE_DEPLOYMENT.md) and packaging work. Do not retry hosted installation, run migrations or change hosting configuration during local development. Reassess process/lock state and resource limits when the user resumes deployment.

Read root/scoped AGENTS and the architecture plan before changes. Reinspect source and Git status; this is a snapshot.

## Settled direction

- One root Git repository; React/Vite frontend, NestJS backend, separate pnpm lockfiles.
- Strict shadcn/ui with the existing Base UI preset, Tailwind tokens and Lucide icons.
- PostgreSQL through pg and explicit versioned SQL through node-pg-migrate; no ORM or startup schema synchronization.
- Better Auth is user-selected but not integrated. Use relevant installed skills and version-matched documentation when authentication work begins.
- Online pilot on existing HostPinnacle, preferably one frontend/API origin. No additional hosting subscription, phone VPN or offline checkout claims.
- Test URL: https://dev.sifulabs.co.ke/. Screenshot shows Node 22.23.2 and Passenger settings. User handles File Manager uploads and panel commands; SSH is unconfirmed and is not required if those commands work.

## Current implementation

- Frontend remains the React 19/Vite 8/TypeScript 6 starter with shadcn Button and theme provider. No business screens.
- Backend: NestJS 12/TypeScript 6, ESM/NodeNext, required validated environment configuration, bounded pg pool and shutdown cleanup.
- GET /api/health/live is database-independent. GET /api/health/ready runs SELECT 1, returns generic 503 on failure. Both use no-store headers. Readiness does not verify schema currency.
- Starter root route still returns Hello World. No frontend is served by this backend.
- Explicit migration creates app_metadata and an application marker; runner tracks history, uses a lock/transaction, and restricts one-step rollback to confirmed non-production use.
- Local PostgreSQL 18.6 service remains running at 127.0.0.1:5432. Dedicated pay_and_go_dev and pay_and_go_test databases have separate same-named non-superuser owners and random credentials in ignored backend/.env and backend/.env.test. Cross-database CONNECT denied; no pre-existing databases modified.
- No login, permissions, catalogue, checkout, inventory, manager reports, M-Pesa/eTIMS or hosted deployment yet.

## Latest deployment preparation

- Added backend/app.cjs: changes working directory to the application root, dynamically imports dist/main.js, and reports a generic failure with exit code 1 on rejected import.
- Moved tslib into runtime dependencies because the compiled application imports it. Updated pnpm lockfile without adding a new package or upgrading its version.
- Added hosting:install (pinned pnpm production/frozen-lockfile install with dependency lifecycle scripts disabled), hosting:migrate (compiled migration, no build), and hosting:package (local Windows ZIP builder).
- The PowerShell packager builds first, creates a unique output directory, copies an explicit file allowlist and verifies ZIP entries. The command uses a process-scoped execution-policy override for this reviewed local script; no machine/user execution policy was changed.
- ZIP contains app.cjs, compiled JS, SQL migrations, package.json, pnpm-lock.yaml and DEPLOYMENT.md. No .env files, local node_modules, npm lockfile, source maps, tests, frontend or Git data.
- Added two Passenger-wrapper regression tests and the [HostPinnacle deployment runbook](HOSTPINNACLE_DEPLOYMENT.md). Read that guide before uploading or executing anything.
- No hosting account actions, uploads, remote commands, new authentication configuration or frontend changes made.

## Historical local artifact

Archive: [.local/releases/20260915-092458-6f72700e/pay-and-go-backend.zip](../.local/releases/20260915-092458-6f72700e/pay-and-go-backend.zip)

SHA256: F85976F3A8BE0CB56E9B16093124B02C5334CC9400F732D1F699004B424E74CB

This archive predates the hosting:diagnose script and current documentation; it is not a current release. Rebuild when deployment resumes. The ZIP has 16 allowlisted files and was created before production dependencies were installed into its sibling staging directory. Upload the ZIP, not the staging directory (which now has verification-only node_modules). Generated artifacts are ignored and not included in clones; recreate with pnpm run hosting:package.

## Verification evidence

Previously recorded backend verification (not rerun for this documentation-only priority change):

- pnpm run hosting:package: build passed, archive allowlist audit passed (16 files).
- pnpm exec tsc --noEmit --incremental false: passed.
- pnpm run test: 19 tests across 4 files passed, including ESM/top-level-await wrapper startup from another directory and sanitized failure exit.
- pnpm run lint and pnpm run test:e2e: passed; 4 HTTP tests.
- Prettier check of app.cjs, test/passenger.spec.ts and package.json: passed.
- Downloaded official portable Node 22.23.2 into ignored .local/node22-verification and verified ZIP SHA256 against Node's official checksum listing. Did not change the installed Node 24.15.0 or global PATH.
- Under Node 22.23.2, npx --yes pnpm@11.10.0 install --prod --frozen-lockfile --ignore-scripts passed in the isolated release staging directory.
- Production-only release app.cjs started from a different working directory on Node 22.23.2; real PostgreSQL-backed live/ready returned HTTP 200 with expected bodies and readiness no-store header. Temporary API process stopped; helper script removed.
- Production migration dependency imported successfully from the isolated staging directory under Node 22.
- Real PostgreSQL migration test passed on Node 22.23.2: 1 test for up, repeated up, down and reapply in a disposable schema. Command from backend: ../.local/node22-verification/node-v22.23.2-win-x64/node.exe --env-file=.env.test node_modules/vitest/vitest.mjs run --config vitest.config.integration.ts (PowerShell needs the call operator).
- git diff --check and final status review passed.

No actual Passenger process, hosted Linux install, hosted database, HTTPS, browser UI, backup restore or phone access has been verified. Local success is not hosted/production readiness. Frontend checks passed in an earlier session, not rerun for this backend-only task.

## Git and local material

Existing wrapper, test, packaging script, package/lockfile and documentation edits remain uncommitted after user commit 4f97177 (setting up hosting). This priority change updates only project rules, architecture and handoff; no commit/push/history rewrite performed. Existing backend/package-lock.json was left untouched and is excluded from deployment; pnpm remains authoritative.

Private backend/.env and backend/.env.test remain ignored. The earlier administrator credential and provisioning helpers were removed. Local archives/caches/binaries/releases are ignored at every .local depth.

Original Git histories remain in .local/git-history/frontend.git (HEAD 43c34d4) and backend.git (HEAD 015a5c5), not part of clones/remotes. Never restore nested repositories.

The committed skills-lock.json records six Better Auth skills; actual skills under ignored .agents/skills must be restored separately on a clone. Backend wrapper dependency resolves to @thallesp/nestjs-better-auth 2.8.0, with Better Auth peer 1.7.4. Better Auth is not yet a direct backend dependency; declare it when application code imports it. The llms.txt web reader previously failed on content type; retry version discovery at implementation time.

## Next work

1. Implement the local Better Auth backend foundation: read backend rules and installed setup/security/email-password skills, verify official documentation against installed versions, declare the direct dependency, and review authentication SQL through the existing migration workflow.
2. Implement and test login, session lookup and logout, protected routes, server-side manager/cashier permissions, and controlled account provisioning without public staff self-registration. Keep credentials and authorization server-side.
3. Add the responsive shadcn-only login and protected application shell, including loading/error/session-expiry behavior. Verify against the local API and separate development/test databases. Authentication and UI remain unimplemented.
4. Build catalogue, then a complete atomic cash-sale/stock/audit/receipt workflow with exact arithmetic and duplicate-submission tests.
5. Resume deployment only when the user requests it. Resolve the installation/process-lock issue and prove hosted runtime/database/HTTPS/mobile access, restart and backup/restore before any hosted pilot. No real trading or payment/fiscal readiness is established.

## Priority-change verification

Documentation-only change: root rules and architecture now permit local feature development before hosting verification. Existing code/dependency changes are preserved. Review document links and run git diff --check and git status --short at handoff; do not treat historical test results as newly run tests.

## Open items

- Actual LVE limits, hosted PostgreSQL connection/TLS/version and backup ownership/retention are unknown. The panel selects named package.json scripts and optional arguments; arbitrary shell entry is not supported by the shown dialog.
- The test URL was unreachable during an earlier inspection; that was not a DNS/TLS diagnosis. Recheck after user deployment.
- Manager authentication/MFA, frontend hosting/SPA routing, simulated versus real trading, weighted goods, payment/fiscal workflow and offline launch requirements remain pending.
- Review the theme provider's global d shortcut before cashier/scanner input.
- Keep external Observe telemetry and the generic Nest deployment helper removed unless explicitly reselected.

Keep durable decisions in the architecture document, conventions in AGENTS files, and evidence/next steps here. Never record secrets or unsupported completion claims.
