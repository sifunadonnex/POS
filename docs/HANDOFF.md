# Pay & Go handoff

**Updated:** 16 September 2026

**Current phase:** Login/security and the first catalogue workflow are implemented and verified locally against PostgreSQL. SMTP delivery, full interactive browser checks and HostPinnacle deployment remain pending. The next business module is inventory opening/receiving/adjustments.

Read root/scoped AGENTS and the architecture before changes. Reinspect Git and source; this is a snapshot.

## Current environment and decisions

- PostgreSQL 18 is installed and the `postgresql-x64-18` Windows service is running. Separate ignored development/test connection settings are present in `backend/.env` and `backend/.env.test`.
- All four migrations through `202609160001_catalogue` are applied to `pay_and_go_dev`. The integration suites use disposable schemas only in the explicitly named `_test` database.
- Two disposable local `.test` staff accounts were provisioned and marked verified for manual testing: one manager and one cashier. Their passwords are not stored in tracked files or this handoff. The manager must enroll authenticator MFA before manager-only features become available.
- At this handoff, the local API and Vite frontend were intentionally left running on ports 3000 and 5173 for the user's manual test. Stop them after testing.
- Use an existing SMTP mailbox later for verification/recovery. Credentials belong only in private backend environment settings; no real email has been sent.
- Keep HostPinnacle work deferred. Local development does not establish hosted compatibility, backups, phone access, payment confirmation or fiscal readiness.

## Implemented

- Better Auth 1.7.4 email/password sessions with controlled staff accounts, required verification, recovery/password change, authenticator MFA and recovery codes.
- Server-side manager/cashier authorization, manager staff administration, suspension/session revocation, security audit and 15-minute inactivity locking. Public signup and direct role/profile mutation are blocked.
- Durable encrypted SMTP outbox and retry worker are implemented; SMTP acceptance/inbox delivery and hosted scheduling remain unverified.
- Catalogue categories/products with `each`, `pack`, `kg` and `l` sale units. Prices are exact integer minor units; `kg`/`l` later use 0.001 quantity steps while `each`/`pack` use whole quantities.
- Unique SKU/barcodes, archive/reactivate, immutable unit after creation, optimistic revisions, append-only product/category history, manager reason capture and idempotent request receipts.
- UTF-8 CSV preview/import with bounded size/rows, create-only semantics, conflict checks and one-transaction all-or-nothing import.
- Responsive shadcn/Base UI screens for identity, staff security and catalogue workflows. This release still has no stock ledger or checkout.

## Verification on 16 September 2026

| Area | Result |
| --- | --- |
| Backend unit | 79 tests in 11 files passed |
| Backend HTTP/e2e | 20 tests in 3 files passed, serial run |
| PostgreSQL integration | 15 tests in 3 files passed against disposable `_test` schemas |
| Backend typecheck, lint, build | Passed |
| Frontend UI/API | 33 tests in 7 files passed, serial run |
| Frontend lint, referenced-project TypeScript build and Vite production build | Passed |
| Development database | All four migrations present; manager and cashier password sign-in plus `/api/identity/me` succeeded; both sessions were signed out |
| Local app smoke | Vite page, proxied liveness and proxied PostgreSQL readiness all returned HTTP 200 |

The first parallel test attempt saturated local worker startup and produced timeouts; all affected suites passed when rerun serially. A stale identity integration assertion was updated to include the already-implemented security fields. No test or compiler/lint rule was weakened.

Database coverage includes migration up/repeat/down/reapply, auth transactions, catalogue concurrent idempotent replay, conflict rollback, price history, stale edits, atomic CSV import, archival and transactional manager/MFA checks. It does not replace real SMTP, visual/browser, load, backup/restore or hosted verification.

## Concrete next step

1. Let the user manually exercise local cashier login and manager login/MFA enrollment, then create a category/product, import the sample CSV, edit/archive a product and inspect history. Record any usability defect.
2. Build inventory opening balances, receiving and adjustments as append-only movements with integer quantity scales: 1 for `each`/`pack`, 0.001 for `kg`/`l`. Define and test checkout fractional-line rounding before implementing sale totals.
3. Later complete SMTP delivery and the remaining [security verification checklist](SECURITY_VERIFICATION.md).
4. Before any hosted pilot, separately prove HostPinnacle runtime/database/TLS/jobs, phone access and backup/restore. Do not resume deployment scripts without a user-directed deployment task.

## Git and deferred hosting

The catalogue workflow is committed at `9fdcef8`. This audit leaves only deliberate test/documentation corrections uncommitted; no commit or push was requested. Private environment files, generated builds and `.local/` scratch files remain ignored.

HostPinnacle target: `https://dev.sifulabs.co.ke/`. Earlier panel evidence showed Node 22.23.2 starting successfully, dependency installation failing under allocation limits, and a later application-lock error. Preserve `backend/app.cjs`, packaging scripts and [the deployment runbook](HOSTPINNACLE_DEPLOYMENT.md); hosted state is still unknown.
