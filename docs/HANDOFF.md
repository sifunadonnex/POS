# Pay & Go handoff

**Updated:** 21 September 2026

**Current phase:** Local backend business flows and the manager-facing inventory/sales workspaces are progressing through stock intake and sales operations. Supplier purchase receipts, supplier directory management, inventory movement recording, sales, returns, shifts, reports and stocktake are implemented and verified locally against PostgreSQL. SMTP delivery, full interactive browser checks and HostPinnacle deployment remain pending.

Read root/scoped AGENTS and the architecture before changes. Reinspect Git and source; this is a snapshot.

## Current environment and decisions

- PostgreSQL 18 is installed and the `postgresql-x64-18` Windows service is running. Separate ignored development/test connection settings are present in `backend/.env` and `backend/.env.test`.
- Migrations through `202609210002_payment_shift_reconciliation` are applied to `pay_and_go_dev`. The integration suites use disposable schemas only in the explicitly named `_test` database.
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
- Manager dashboard now loads the real daily report summary, presents operational KPIs/payment mix with loading and retry states, and keeps cashier actions honest until each module is available.
- Staff workspace sidebar is grouped into Workspace, Sell, Inventory, Insights and Administration, with existing modules active and planned modules visibly marked as coming next rather than exposed as fake actions.
- Sales register now uses active catalogue lookup/barcode search, server-authoritative basket quotes, request-replay-safe sale/payment confirmation, and an open/current/close shift flow with loading, error and retry states. A `GET /api/shifts/current` read was added so register refreshes recover the active shift instead of opening a duplicate.
- Confirmed payments now attach to the active shift; cash payments create linked append-only `cash_in` movements, and shift closing calculates expected cash and variance from the movement ledger. Migration `202609210002_payment_shift_reconciliation` is applied locally.
- Backend stock API for opening, receiving and adjustments with append-only inventory movements and quantity validation for each/pack/kg/l units.
- Manager Stock control workspace now loads real stock balances, supports search and paging, posts opening/receive/adjust movements with exact unit-aware quantities and replay-safe request IDs, and displays per-product movement history with loading, empty, error and retry states. It is wired into the manager-only Inventory sidebar; no low-stock threshold badge is shown because the current API does not provide an authoritative threshold.
- Manager Purchase intake workspace now lists and creates suppliers through manager-only endpoints, searches active catalogue products, builds exact unit-aware receipt lines, previews totals, and posts supplier receipts through the existing transactional purchase endpoint with replay-safe retry handling. It is wired into the manager-only Inventory sidebar.
- Supplier purchase receipt and supplier-return flows with request replay protection, supplier validation, exact unit-aware totals, cumulative return limits, stock movement logging and append-only receipt history. Supplier directory listing and manager creation are now available.
- Sales, customer returns, shifts, reports and stocktake flows are transactional and replay-safe. Checkout and refunds use server-authoritative catalogue/sale prices; split payments and repeated returns cannot exceed their source totals.
- Forward migrations `202609210001_business_invariants` and `202609210002_payment_shift_reconciliation` permit `stocktake` inventory movements, enforce non-negative stock, permit only one open shift per cashier, allow a single open-to-closed shift transition, and link confirmed payments to shift reconciliation.
- Fractional minor-unit line totals are rejected with a clear error until the documented rounding examples are agreed; no silent rounding was introduced.

## Verification on 21 September 2026

| Area                            | Result                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend unit                    | 100 tests in 19 files passed                                                                                                                              |
| PostgreSQL integration          | 15 tests in 3 files passed against disposable `_test` schemas                                                                                             |
| HTTP/e2e                        | 20 tests in 3 files passed                                                                                                                                |
| Backend typecheck/build         | Passed                                                                                                                                                    |
| Backend lint                    | Passed with two unused-parameter warnings in tests                                                                                                        |
| Local API business flows        | New stock/sales/purchase paths passed unit and HTTP contract coverage; PostgreSQL business-flow integration remains pending                               |
| Development database            | Local PostgreSQL migrations through `202609210002_payment_shift_reconciliation` applied successfully                                                       |
| Business invariants             | Regression coverage passed for server pricing, cumulative payments/returns, exact unit-aware totals, shift ownership and stocktake movement compatibility |
| Frontend lint/typecheck         | Passed                                                                                                                                                    |
| Frontend tests                  | 45 tests in 12 files passed serially                                                                                                                      |
| Frontend production build       | Passed                                                                                                                                                    |
| Frontend formatting/diff checks | Prettier check and `git diff --check` passed                                                                                                              |
| Frontend visual/browser check   | Vite started successfully on port 5175 for this module; in-app browser connector unavailable in this session                                               |

The first parallel test attempt saturated local worker startup and produced timeouts; all affected suites passed when rerun serially. A stale identity integration assertion was updated to include the already-implemented security fields. No test or compiler/lint rule was weakened.

Database coverage includes migration up/repeat/down/reapply, auth transactions, catalogue concurrent idempotent replay, conflict rollback, price history, stale edits, atomic CSV import, archival and transactional manager/MFA checks. The new stock/sales/purchase paths have unit and HTTP coverage but still need a dedicated PostgreSQL business-flow integration suite. This does not replace real SMTP, visual/browser, load, backup/restore or hosted verification.

## Concrete next step

1. Add the next module behind the sidebar: Returns, using the existing customer-return contracts and server-authoritative refund flow.
2. Add receipt/reprint and held-basket behavior to the register, then extend the register business-flow integration coverage beyond migration validation.
3. Add the supplier ledger and purchase reconciliation/reporting endpoints around the new supplier directory and receipt records.
4. Agree worked examples for fractional sale/refund rounding before enabling those cases, then add a dedicated PostgreSQL business-flow integration suite.
5. Later complete SMTP delivery and the remaining [security verification checklist](SECURITY_VERIFICATION.md), then separately prove HostPinnacle runtime/database/TLS/jobs, phone access and backup/restore.

## Git and deferred hosting

The catalogue workflow is committed at `9fdcef8`. This audit leaves only deliberate test/documentation corrections uncommitted; no commit or push was requested. Private environment files, generated builds and `.local/` scratch files remain ignored.

HostPinnacle target: `https://dev.sifulabs.co.ke/`. Earlier panel evidence showed Node 22.23.2 starting successfully, dependency installation failing under allocation limits, and a later application-lock error. Preserve `backend/app.cjs`, packaging scripts and [the deployment runbook](HOSTPINNACLE_DEPLOYMENT.md); hosted state is still unknown.
