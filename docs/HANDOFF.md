# Pay & Go handoff

**Updated:** 21 September 2026

**Current phase:** Local backend business flows are now progressing through stock intake and sales operations. Supplier purchase receipts, inventory movement recording, sales, returns, shifts, reports and stocktake are implemented and verified locally against PostgreSQL. SMTP delivery, full interactive browser checks and HostPinnacle deployment remain pending.

Read root/scoped AGENTS and the architecture before changes. Reinspect Git and source; this is a snapshot.

## Current environment and decisions

- PostgreSQL 18 is installed and the `postgresql-x64-18` Windows service is running. Separate ignored development/test connection settings are present in `backend/.env` and `backend/.env.test`.
- Migrations through `202609210001_business_invariants` are applied to `pay_and_go_dev`. The integration suites use disposable schemas only in the explicitly named `_test` database.
- Two disposable local `.test` staff accounts were provisioned and marked verified for manual testing: one manager and one cashier. Their passwords are not stored in tracked files or this handoff. The manager must enroll authenticator MFA before manager-only features become available.
- The local API and Vite frontend are stopped at this handoff. Start them separately when manual testing is needed.
- Use an existing SMTP mailbox later for verification/recovery. Credentials belong only in private backend environment settings; no real email has been sent.
- Keep HostPinnacle work deferred. Local development does not establish hosted compatibility, backups, phone access, payment confirmation or fiscal readiness.

## Implemented

- Better Auth 1.7.4 email/password sessions with controlled staff accounts, required verification, recovery/password change, authenticator MFA and recovery codes.
- Server-side manager/cashier authorization, manager staff administration, suspension/session revocation, security audit and 15-minute inactivity locking. Public signup and direct role/profile mutation are blocked.
- Durable encrypted SMTP outbox and retry worker are implemented; SMTP acceptance/inbox delivery and hosted scheduling remain unverified.
- Catalogue categories/products with `each`, `pack`, `kg` and `l` sale units. Prices are exact integer minor units; `kg`/`l` later use 0.001 quantity steps while `each`/`pack` use whole quantities.
- Unique SKU/barcodes, archive/reactivate, immutable unit after creation, optimistic revisions, append-only product/category history, manager reason capture and idempotent request receipts.
- UTF-8 CSV preview/import with bounded size/rows, create-only semantics, conflict checks and one-transaction all-or-nothing import.
- Responsive shadcn/Base UI screens for identity, staff security and catalogue workflows.
- Product UI direction is now aligned to a clean Dynamics 365 Commerce-inspired operational shell, using shadcn components and a dense commercial dashboard layout rather than a consumer SaaS aesthetic.
- Manager dashboard now loads the real daily report summary, presents operational KPIs/payment mix with loading and retry states, and keeps cashier actions honest until register APIs are wired.
- Staff workspace sidebar is grouped into Workspace, Sell, Inventory, Insights and Administration, with existing modules active and planned modules visibly marked as coming next rather than exposed as fake actions.
- Backend stock API for opening, receiving and adjustments with append-only inventory movements and quantity validation for each/pack/kg/l units.
- Supplier purchase receipt and supplier-return flows with request replay protection, supplier validation, exact unit-aware totals, cumulative return limits, stock movement logging and append-only receipt history.
- Sales, customer returns, shifts, reports and stocktake flows are transactional and replay-safe. Checkout and refunds use server-authoritative catalogue/sale prices; split payments and repeated returns cannot exceed their source totals.
- Forward migration `202609210001_business_invariants` permits `stocktake` inventory movements, enforces non-negative stock, permits only one open shift per cashier and allows a single open-to-closed shift transition.
- Fractional minor-unit line totals are rejected with a clear error until the documented rounding examples are agreed; no silent rounding was introduced.

## Verification on 21 September 2026

| Area | Result |
| --- | --- |
| Backend unit | 96 tests in 18 files passed |
| PostgreSQL integration | 15 tests in 3 files passed against disposable `_test` schemas |
| HTTP/e2e | 20 tests in 3 files passed |
| Backend typecheck/build | Passed |
| Backend lint | Passed with two unused-parameter warnings in tests |
| Local API business flows | New stock/sales/purchase paths passed unit and HTTP contract coverage; PostgreSQL business-flow integration remains pending |
| Development database | Local PostgreSQL migration `202609210001_business_invariants` applied successfully |
| Business invariants | Regression coverage passed for server pricing, cumulative payments/returns, exact unit-aware totals, shift ownership and stocktake movement compatibility |
| Frontend lint/typecheck | Passed |
| Frontend tests | 33 tests in 7 files passed serially |
| Frontend production build | Passed |
| Frontend formatting/diff checks | Prettier check and `git diff --check` passed |
| Frontend visual/browser check | Vite started successfully on port 5173; in-app browser connector unavailable in this session |

The first parallel test attempt saturated local worker startup and produced timeouts; all affected suites passed when rerun serially. A stale identity integration assertion was updated to include the already-implemented security fields. No test or compiler/lint rule was weakened.

Database coverage includes migration up/repeat/down/reapply, auth transactions, catalogue concurrent idempotent replay, conflict rollback, price history, stale edits, atomic CSV import, archival and transactional manager/MFA checks. The new stock/sales/purchase paths have unit and HTTP coverage but still need a dedicated PostgreSQL business-flow integration suite. This does not replace real SMTP, visual/browser, load, backup/restore or hosted verification.

## Concrete next step

1. Wire the Sales register module to the existing checkout/shift APIs and replace its remaining placeholder interaction paths with server-backed flows.
2. Add the next inventory module behind the sidebar: stock control, including the report's low-stock threshold source and movement history.
3. Add the supplier ledger and purchase reconciliation/reporting endpoints; supplier creation/listing is still not an API capability.
4. Agree worked examples for fractional sale/refund rounding before enabling those cases, then add a dedicated PostgreSQL business-flow integration suite.
5. Later complete SMTP delivery and the remaining [security verification checklist](SECURITY_VERIFICATION.md), then separately prove HostPinnacle runtime/database/TLS/jobs, phone access and backup/restore.

## Git and deferred hosting

The catalogue workflow is committed at `9fdcef8`. This audit leaves only deliberate test/documentation corrections uncommitted; no commit or push was requested. Private environment files, generated builds and `.local/` scratch files remain ignored.

HostPinnacle target: `https://dev.sifulabs.co.ke/`. Earlier panel evidence showed Node 22.23.2 starting successfully, dependency installation failing under allocation limits, and a later application-lock error. Preserve `backend/app.cjs`, packaging scripts and [the deployment runbook](HOSTPINNACLE_DEPLOYMENT.md); hosted state is still unknown.
