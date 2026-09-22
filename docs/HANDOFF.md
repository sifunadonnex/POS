# Pay & Go handoff

**Updated:** 22 September 2026

**Current phase:** Local backend business flows and the manager-facing inventory/sales workspaces are progressing through stock intake and sales operations, with the Returns, Stocktake and Purchase reconciliation workspaces now wired for operator use. Supplier purchase receipts, supplier directory management, supplier ledgers, purchase reconciliation, inventory movement recording, sales, returns, shifts, reports and stocktake are implemented and verified locally. SMTP delivery, full interactive browser checks and HostPinnacle deployment remain pending.

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
- Responsive shadcn/Base UI screens for identity, staff security and catalogue workflows. Authentication now uses an image-backed retail entry shell with a focused staff sign-in panel, guided recovery/email-verification states, staged MFA enrollment/challenge UI, accessible password visibility controls and explicit loading/offline/locked states. The project-local background was generated without logos, text or identifiable people.
- Product UI direction is now aligned to a clean Dynamics 365 Commerce-inspired operational shell, using shadcn components and a dense commercial dashboard layout rather than a consumer SaaS aesthetic.
- Manager dashboard now loads the real daily report summary, presents operational KPIs/payment mix with loading and retry states, and keeps cashier actions honest until each module is available.
- Staff workspace sidebar is grouped into Workspace, Sell, Inventory, Insights and Administration, with existing modules active and planned modules visibly marked as coming next rather than exposed as fake actions.
- Sales register now uses active catalogue lookup/barcode search, server-authoritative basket quotes, request-replay-safe sale/payment confirmation, and an open/current/close shift flow with loading, error and retry states. It also supports device-local held basket drafts, server-authoritative paid receipt lookup/reprint and clear recovery when payment is confirmed but the receipt read is unavailable. A `GET /api/shifts/current` read was added so register refreshes recover the active shift instead of opening a duplicate.
- Confirmed payments now attach to the active shift; cash payments create linked append-only `cash_in` movements, and shift closing calculates expected cash and variance from the movement ledger. Migration `202609210002_payment_shift_reconciliation` is applied locally.
- Backend stock API for opening, receiving and adjustments with append-only inventory movements and quantity validation for each/pack/kg/l units.
- Manager Stock control workspace now loads real stock balances, supports search and paging, posts opening/receive/adjust movements with exact unit-aware quantities and replay-safe request IDs, and displays per-product movement history with loading, empty, error and retry states. It is wired into the manager-only Inventory sidebar; no low-stock threshold badge is shown because the current API does not provide an authoritative threshold.
- Manager Purchase intake workspace now lists and creates suppliers through manager-only endpoints, searches active catalogue products, builds exact unit-aware receipt lines, previews totals, and posts supplier receipts through the existing transactional purchase endpoint with replay-safe retry handling. It is wired into the manager-only Inventory sidebar.
- Manager Purchase reports workspace now filters a date-bounded reconciliation report, shows received/returned/net purchase totals, rolls activity up by supplier, reconciles each receipt against supplier returns, and drills into a signed supplier ledger. The reads are manager-only and derive from append-only receipt/return records; no browser cache is used for authoritative history.
- Returns workspace now searches completed sales, loads server-calculated refundable line quantities, previews exact refund totals, and submits replay-safe customer returns that restore stock and record the paid refund through the existing transactional return endpoint. It is available to cashiers and managers in the Sell sidebar.
- Manager Stocktake workspace now loads authoritative stock balances, supports search and paging, accepts exact unit-aware physical counts, previews the reconciliation delta, and posts replay-safe counts through the transactional stocktake endpoint. It is wired into the manager-only Inventory sidebar.
- Supplier purchase receipt and supplier-return flows with request replay protection, supplier validation, exact unit-aware totals, cumulative return limits, stock movement logging and append-only receipt history. Supplier directory listing and manager creation are now available.
- Sales, customer returns, shifts, reports and stocktake flows are transactional and replay-safe. Checkout and refunds use server-authoritative catalogue/sale prices; split payments and repeated returns cannot exceed their source totals.
- Stock-changing product reads now lock only the catalogue row in PostgreSQL. This preserves per-product serialization without trying to lock the nullable inventory side of a left join, which previously prevented first receipts and sales from committing.
- Forward migrations `202609210001_business_invariants` and `202609210002_payment_shift_reconciliation` permit `stocktake` inventory movements, enforce non-negative stock, permit only one open shift per cashier, allow a single open-to-closed shift transition, and link confirmed payments to shift reconciliation.
- Fractional minor-unit line totals are rejected with a clear error until the documented rounding examples are agreed; no silent rounding was introduced.

## Verification on 22 September 2026

| Area                            | Result                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend unit                    | 106 tests in 21 files passed serially                                                                                                                     |
| PostgreSQL integration          | 17 tests in 4 files passed against disposable `_test` schemas                                                                                             |
| HTTP/e2e                        | 20 tests in 3 files passed                                                                                                                                |
| Backend typecheck/build         | Passed                                                                                                                                                    |
| Backend lint                    | Passed with two unused-parameter warnings in tests                                                                                                        |
| Local API business flows        | Supplier receipt/return, reconciliation/ledger, register sale/payment and shift-close paths passed dedicated PostgreSQL business-flow coverage           |
| Development database            | Local PostgreSQL migrations through `202609210002_payment_shift_reconciliation` applied successfully                                                       |
| Business invariants             | Regression coverage passed for server pricing, cumulative payments/returns, exact unit-aware totals, shift ownership and stocktake movement compatibility |
| Frontend lint/typecheck         | Passed                                                                                                                                                    |
| Frontend tests                  | 60 tests in 18 files passed serially                                                                                                                      |
| Frontend production build       | Passed                                                                                                                                                    |
| Frontend formatting/diff checks | Prettier check and `git diff --check` passed                                                                                                              |
| Frontend visual/browser check   | Vite started on port 5179 for the auth redesign; browser connector exposed no browser session, so responsive visual interaction remains unverified      |

The first parallel test attempt saturated local worker startup and produced timeouts; all affected suites passed when rerun serially. A stale identity integration assertion was updated to include the already-implemented security fields. No test or compiler/lint rule was weakened.

Database coverage includes migration up/repeat/down/reapply, auth transactions, catalogue concurrent idempotent replay, conflict rollback, price history, stale edits, atomic CSV import, archival and transactional manager/MFA checks. Dedicated PostgreSQL coverage now verifies replay-safe supplier receipts/returns, reconciliation and signed supplier ledger reads, plus cash sale/payment/shift-close movement reconciliation. This does not replace real SMTP, visual/browser, load, backup/restore or hosted verification.

## Concrete next step

1. Agree worked examples for fractional sale/refund rounding before enabling those cases, then add the rounding rules to the PostgreSQL business-flow suite.
2. Perform the browser-based manager walkthrough when a browser session is available, including report filtering and supplier-ledger drill-down.
3. Later complete SMTP delivery and the remaining [security verification checklist](SECURITY_VERIFICATION.md), then separately prove HostPinnacle runtime/database/TLS/jobs, phone access and backup/restore.

## Git and deferred hosting

The catalogue workflow is committed at `9fdcef8`. This audit leaves deliberate PostgreSQL lock corrections, business-flow integration coverage and handoff updates uncommitted; no commit or push was requested. Private environment files, generated builds and `.local/` scratch files remain ignored.

HostPinnacle target: `https://dev.sifulabs.co.ke/`. Earlier panel evidence showed Node 22.23.2 starting successfully, dependency installation failing under allocation limits, and a later application-lock error. Preserve `backend/app.cjs`, packaging scripts and [the deployment runbook](HOSTPINNACLE_DEPLOYMENT.md); hosted state is still unknown.
