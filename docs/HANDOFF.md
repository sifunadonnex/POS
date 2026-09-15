# Pay & Go handoff

**Updated:** 16 September 2026

**Current phase:** Login/security follow-up implemented in source, with database-independent verification complete. PostgreSQL, SMTP delivery and browser verification remain pending. Deployment remains deferred.

Read root/scoped AGENTS and the architecture before changes. Reinspect Git and source; this is a snapshot.

## User-confirmed scope and environment

- Finish remaining login/security work first, before the full POS backlog.
- PostgreSQL is **not installed on this machine** (confirmed 15 September). Do not install it, run migrations, provision accounts or claim real database checks as part of this deferred phase. Previous PostgreSQL 18.6 results are historical.
- Use an existing SMTP mailbox for verification and recovery. Configuration belongs in private backend environment settings; credentials have not been requested or printed. No real email was sent.
- The later first catalogue/checkout must include weight and volume sales. Exact unit precision and rounding examples still need definition.
- Preserve HostPinnacle work; local development proceeds without deployment troubleshooting.

## Implemented

- Better Auth 1.7.4 remains pinned in both projects, with Nest wrapper 2.8.0. No ORM, competing UI kit, multi-tenancy or paid identity service.
- Required email verification; 30-minute password-reset/verification links; password change; generic recovery responses and explicit delivery-unavailable errors.
- Authenticator MFA and one-time recovery codes. Managers cannot use protected business/staff routes without proof on the current session. Cashiers can opt in. Trusted-device/OTP/disable-MFA bypasses are blocked. Public signup/direct profile mutation remain blocked.
- Manager staff screens and server routes: bounded search/list, create, edit name/role/status, suspend/reactivate, revoke sessions, reset another user's MFA, request verification/password-setup links. Sensitive actions require the acting manager's password and reason; database transactions recheck current manager/session authority, serialize administration and reject stale edits/self-demotion/self-suspension.
- New staff created in the UI receive a random undisclosed initial password and choose their own through recovery. Bootstrap provisioning remains local-only; its users must verify their email before login.
- Server and browser 15-minute inactivity locking. Only actual input activity triggers heartbeats; periodic session polling does not extend idle access. Failed sign-out hides private content and stays locked. Sessions retain the eight-hour creation cap and nonpersistent cookies.
- Sanitized auth outcomes, staff/password/session mutation audit, and paged manager security history. Database trigger prevents audit updates/deletes; this is not tamper resistance against a privileged database owner.
- SMTP transport pinned to Nodemailer 10.0.10 and types 8.0.1, using TLS with certificate verification. Encrypted PostgreSQL email jobs, bounded retries and expiration survive process restarts. The local timer runs only while the backend runs; hosted scheduling/recycling remains unverified.
- Responsive screens compose existing Base UI shadcn components. Recovery token fragments are removed from the address bar. Loading, errors, retries and repeated-submission guards are included.

## Migration and configuration

- Added **unapplied** `backend/migrations/202609150002_identity_security.sql`: staff status/revision, MFA schema, session proof/activity, auth audit, encrypted mail outbox, and session/challenge revocation triggers.
- Existing emails are not automatically verified. The migration down path deletes MFA/queue/audit state and is only for deliberate disposable-test rollback.
- Added sanitized SMTP keys to `backend/.env.example`. No existing private `.env` values were changed by this follow-up.
- See [local auth setup](LOCAL_AUTH_SETUP.md) for SMTP settings, later migration/provisioning commands, manager enrollment and staff onboarding.
- No development accounts, database installation, migrations, actual SMTP delivery or deployment were performed in this follow-up.

## Verification on 16 September 2026

Commands were run through installed Node entrypoints after the sandboxed pnpm launcher failed with EPERM. No tests or compiler/lint rules were weakened.

| Area | Command from its project directory | Result |
| --- | --- | --- |
| Backend unit | `node node_modules/vitest/vitest.mjs run` | 47 tests, 8 files passed |
| Backend HTTP | `node node_modules/vitest/vitest.mjs run --config vitest.config.e2e.ts` | 12 tests, 2 files passed |
| Backend source + test types | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Passed |
| Backend lint | `node node_modules/oxlint/bin/oxlint src/ test/` | Passed, no warnings |
| Backend build | `node node_modules/@nestjs/cli/bin/nest.js build` | Passed |
| Frontend UI/API | `node node_modules/vitest/vitest.mjs run` | 22 tests, 5 files passed |
| Frontend lint | `node node_modules/eslint/bin/eslint.js .` | Passed |
| Frontend build | `node node_modules/typescript/bin/tsc -b`, then `node node_modules/vite/bin/vite.js build` | Passed; includes both referenced TypeScript projects |

- Changed source passed each project's Prettier check. Final `git diff --check`, new-file whitespace checks and `git status --short` review passed; only intentional source/configuration/test/documentation changes remain.
- Tests cover policy validation, TLS/redacted failures, encrypted queue/retries, anonymous/cashier/MFA/idle restrictions, recovery/enrollment flows, unknown staff-save outcomes, confirmations and screen locking.
- Real PostgreSQL integration tests were extended but **not run**. SQL transaction/concurrency behavior and Better Auth's real cookie/MFA/reset flows remain unverified for this migration.
- Browser skill setup found no available browser connection; no visual or interactive browser pass is claimed. No temporary app/browser service was started.
- Real SMTP acceptance/inbox arrival, hosting, phone access, backup/restore, sales, payments and fiscal behavior remain unverified.

## Concrete next steps

1. Complete the explicit [deferred security verification checklist](SECURITY_VERIFICATION.md) when PostgreSQL and a browser are available: isolated migrations/integration tests, real manager/cashier flows, SMTP to controlled test inboxes, idle/offline cases and concurrency/recovery checks. Fix any resulting integration defects before calling the feature connected and verified.
2. If continuing code development while PostgreSQL stays deferred, the next feature is catalogue with whole-item/weight/volume units, exact quantity arithmetic and manager-only writes. Keep checkout/stock/returns/shifts/reports as later modules.
3. Before a hosted pilot, separately prove scheduling/SMTP, proxy trust, HTTPS, PostgreSQL, phone access and backup/restore. Do not resume hosting scripts without a user-directed deployment task.

## Deferred hosting and Git state

HostPinnacle remains the target; user URL is https://dev.sifulabs.co.ke/. Earlier panel evidence: Node 22.23.2 diagnostic succeeded; dependency installation hit allocation errors under a reported 4 GiB address-space limit; later error was "Can't acquire lock for app: dev". Active process versus stale lock remains unknown. Preserve `backend/app.cjs`, packaging scripts and [deployment runbook](HOSTPINNACLE_DEPLOYMENT.md). Old release ZIPs predate this work.

Initial authentication is committed in `d9dccc2` (first round), following `96f9224` (Deployment is deferred). This follow-up intentionally leaves modified/new backend identity code, SQL migration, tests, frontend security screens, backend dependency/lockfile and documentation **uncommitted**. No commit/push/history rewrite was authorized. Existing backend package-lock.json is untouched; pnpm lockfiles are authoritative.

Private environment files, generated builds, browser scratch files, archives and `.local/git-history/` remain ignored. Never restore nested repositories or commit the private credential files. `skills-lock.json` remains tracked; Better Auth skill guidance was read from its upstream source because local skill files were absent.
