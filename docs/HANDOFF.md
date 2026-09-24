# Pay & Go handoff

**Updated:** 23 September 2026

**Current phase:** Local backend business flows and the manager-facing inventory/sales workspaces are progressing through stock intake and sales operations, with the Returns, Stocktake and Purchase reconciliation workspaces wired for operator use and the external-payment persistence/reconciliation foundation implemented behind a disabled gateway. Supplier purchase receipts, supplier directory management, supplier ledgers, purchase reconciliation, inventory movement recording, sales, returns, shifts, reports and stocktake are implemented and verified locally. The current manager/cashier browser walkthrough is complete; real payment providers, SMTP delivery and HostPinnacle deployment remain pending.

Read root/scoped AGENTS and the architecture before changes. Reinspect Git and source; this is a snapshot.

## Current environment and decisions

- PostgreSQL 18 is installed and the `postgresql-x64-18` Windows service is running. Separate ignored development/test connection settings are present in `backend/.env` and `backend/.env.test`.
- Migrations through `202609230001_payment_attempts` are applied to `pay_and_go_dev`. The integration suites use disposable schemas only in the explicitly named `_test` database.
- Two disposable local `.test` staff accounts were provisioned and marked verified for manual testing: one manager and one cashier. Their passwords are not stored in tracked files or this handoff. The manager must enroll authenticator MFA before manager-only features become available.
- The local API and Vite frontend are stopped at this handoff. Start them separately when manual testing is needed.
- Use an existing SMTP mailbox later for verification/recovery. Credentials belong only in private backend environment settings; no real email has been sent.
- Keep HostPinnacle work deferred. Local development does not establish hosted compatibility, backups, phone access, payment confirmation or fiscal readiness.

## Implemented

- Better Auth 1.7.4 email/password sessions with controlled staff accounts, required verification, recovery/password change, authenticator MFA and recovery codes.
- Server-side manager/cashier authorization, manager staff administration, suspension/session revocation, security audit and 15-minute inactivity locking. Public signup and direct role/profile mutation are blocked.
- Transactional sale, return, purchase, shift and stocktake writes enforce the same conditional MFA policy as the identity boundary: managers and any 2FA-enabled cashier require a verified MFA session, while a verified password-only cashier remains authorized for cashier work.
- Durable encrypted SMTP outbox and retry worker are implemented; SMTP acceptance/inbox delivery and hosted scheduling remain unverified.
- Catalogue categories/products with `each`, `pack`, `kg` and `l` sale units. Prices are exact integer minor units; `kg`/`l` later use 0.001 quantity steps while `each`/`pack` use whole quantities.
- Unique SKU/barcodes, archive/reactivate, immutable unit after creation, optimistic revisions, append-only product/category history, manager reason capture and idempotent request receipts.
- UTF-8 CSV preview/import with bounded size/rows, create-only semantics, conflict checks and one-transaction all-or-nothing import.
- Responsive shadcn/Base UI screens for identity, staff security and catalogue workflows. Authentication now uses an image-backed retail entry shell with a focused staff sign-in panel, guided recovery/email-verification states, staged MFA enrollment/challenge UI, accessible password visibility controls and explicit loading/offline/locked states. The project-local background was generated without logos, text or identifiable people.
- Product UI direction is now aligned to a clean Dynamics 365 Commerce-inspired operational shell, using shadcn components and a dense commercial dashboard layout rather than a consumer SaaS aesthetic.
- Dashboard now presents role-specific quick actions, a live operational workspace and accurate links to every implemented sales, returns, catalogue, stock, purchase, stocktake and reporting flow. The manager view loads the real daily summary with operational KPIs, payment-mix percentages, shift reconciliation, loading/error/retry states and low-stock attention; the cashier view keeps manager figures private.
- Staff workspace sidebar is grouped into Workspace, Sell, Inventory, Insights and Administration, with implemented modules active and unavailable work kept out of the operator path rather than exposed as fake actions.
- Sales register now uses active catalogue lookup/barcode search, server-authoritative basket quotes, and a single request-replay-safe cash checkout transaction. A cash checkout commits the sale, payment, tender, stock reduction and cash movements together; it calculates change before confirmation and includes cash received/change given on the retrievable receipt. It also supports device-local held basket drafts and a server-authoritative receipt lookup/reprint. A `GET /api/shifts/current` read lets register refreshes recover the active shift instead of opening a duplicate.
- Confirmed payments attach to the active shift. Tendered cash records append-only `cash_in` and, where needed, `cash_out` change movements, so shift closing derives expected cash from the movement ledger. Card and M-Pesa are visibly unavailable until a verified provider confirmation workflow and M-Pesa STK Push adapter are implemented; they are no longer treated as paid by the register.
- Card/M-Pesa now have a provider-neutral durable attempt foundation: request replay protection, exact outstanding-balance capture, originating-shift linkage, pending/confirmed/failed/unknown states, append-only provider events, duplicate-event protection and explicit reconciliation. A provider confirmation creates one non-cash `sale_payment` only when its reference and amount match; unknown attempts block a second charge. The runtime gateway and register methods remain disabled, and no live credentials, callbacks or external calls were added.
- Backend stock API for opening, receiving and adjustments with append-only inventory movements and quantity validation for each/pack/kg/l units. Stock balance and movement-history reads normalize PostgreSQL `bigint` values to the numeric browser API contract; history also exposes sale and customer-return movements.
- Manager Stock control workspace now loads real stock balances, supports search and paging, posts opening/receive/adjust movements with exact unit-aware quantities and replay-safe request IDs, and displays per-product movement history with loading, empty, error and retry states. It is wired into the manager-only Inventory sidebar; no low-stock threshold badge is shown because the current API does not provide an authoritative threshold.
- Manager Purchase intake workspace now lists and creates suppliers through manager-only endpoints, searches active catalogue products, builds exact unit-aware receipt lines, previews totals, and posts supplier receipts through the existing transactional purchase endpoint with replay-safe retry handling. It is wired into the manager-only Inventory sidebar.
- Manager Purchase reports workspace now filters a date-bounded reconciliation report, shows received/returned/net purchase totals, rolls activity up by supplier, reconciles each receipt against supplier returns, and drills into a signed supplier ledger. The reads are manager-only and derive from append-only receipt/return records; no browser cache is used for authoritative history.
- Purchase-report screen coverage verifies the rendered reconciliation totals, receipt table, valid and inverted date ranges, and supplier-ledger drill-down in addition to the existing API, service and PostgreSQL business-flow tests.
- Returns workspace now searches completed sales, loads server-calculated refundable line quantities, previews the same cumulative half-up refund allocation used by the server, and submits replay-safe customer returns that restore stock and record the paid refund through the existing transactional return endpoint. It is available to cashiers and managers in the Sell sidebar.
- Manager Stocktake workspace now loads authoritative stock balances, supports search and paging, accepts exact unit-aware physical counts, previews the reconciliation delta, and posts replay-safe counts through the transactional stocktake endpoint. It is wired into the manager-only Inventory sidebar.
- Supplier purchase receipt and supplier-return flows with request replay protection, supplier validation, exact unit-aware totals, cumulative return limits, stock movement logging and append-only receipt history. Supplier directory listing and manager creation are now available.
- Sales, customer returns, shifts, reports and stocktake flows are transactional and replay-safe. Checkout and refunds use server-authoritative catalogue/sale prices; split payments and repeated returns cannot exceed their source totals.
- Stock-changing product reads now lock only the catalogue row in PostgreSQL. This preserves per-product serialization without trying to lock the nullable inventory side of a left join, which previously prevented first receipts and sales from committing.
- Forward migrations through `202609230001_payment_attempts` permit `stocktake` inventory movements, enforce non-negative stock, permit only one open shift per cashier, allow a single open-to-closed shift transition, link confirmed payments to shift reconciliation, retain cash tender amounts, and persist protected external payment attempts/events.
- Fractional checkout lines now round to the nearest minor unit with exact halves up after exact integer multiplication. Repeated partial customer refunds use the difference between rounded cumulative values, so a full return reconciles exactly to the immutable sale-line total without over-refunding. Supplier receipt/return lines remain exact-only pending a supplier-cost rounding decision.

## Verification on 23 September 2026

| Area                            | Result                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend unit                    | 110 tests in 22 files passed serially                                                                                                                      |
| PostgreSQL integration          | 19 tests in 4 files passed against disposable `_test` schemas; payment/migration focus passed 5 tests                                                     |
| HTTP/e2e                        | 20 tests in 3 files passed                                                                                                                                |
| Backend typecheck/build         | Passed                                                                                                                                                    |
| Backend lint                    | Passed with two unused-parameter warnings in tests                                                                                                        |
| Local API business flows        | Supplier receipt/return, reconciliation/ledger, cash checkout, external payment attempts/reconciliation and shift-close paths passed PostgreSQL coverage  |
| Inventory / stocktake focus     | Inventory bigint response conversion: 3 backend unit tests, 8 Stock control/Stocktake frontend tests and 2 PostgreSQL business-flow tests passed          |
| Development database            | Local PostgreSQL migrations through `202609230001_payment_attempts` applied successfully                                                                  |
| Business invariants             | Coverage passed for pricing/rounding, cumulative refunds, exact provider amount matching, idempotent events, payment limits and shift ownership            |
| Frontend lint/typecheck         | Passed                                                                                                                                                    |
| Frontend tests                  | 68 tests in 20 files passed serially; focused return-screen coverage also passed 3/3                                                                     |
| Frontend production build       | Passed                                                                                                                                                    |
| Frontend formatting/diff checks | Prettier check and `git diff --check` passed                                                                                                              |
| Frontend visual/browser check   | Existing manager/cashier workflow walkthrough passed; the refreshed cashier dashboard also passed a real desktop dark-theme browser review. The current browser surface did not expose a phone-width override |

The full backend unit, HTTP and PostgreSQL integration runs passed. Backend build, test-inclusive typecheck and lint also passed; lint retains two existing unused-parameter warnings in tests. The prior full frontend serial run and production build passed; Vite retained its existing warning that the main minified chunk is just over 500 kB. No test timeout, compiler setting or lint rule was weakened.

Database coverage includes migration up/repeat/down/reapply, auth transactions, catalogue concurrent idempotent replay, conflict rollback, price history, stale edits, atomic CSV import, archival and transactional manager/MFA checks. Dedicated PostgreSQL coverage verifies replay-safe supplier receipts/returns, reconciliation and signed supplier ledger reads, cash checkout with tender/change and shift-close reconciliation, cumulative fractional refunds, and external-payment immediate confirmation, request/event deduplication, unknown-result blocking, delayed reconciliation, decline/retry, exact amount matching and non-cash movement behavior. The browser walkthrough left clearly named disposable product, inventory, stocktake, sale and shift records in the local development database. This does not replace real provider, SMTP, load, backup/restore or hosted verification.

## Concrete next step

1. Choose and authorize the real card and/or M-Pesa operating workflow, then configure the matching gateway, provider-authenticated callback/reconciliation route and register pending/unknown UI before enabling either method. Add M-Pesa STK Push only with approved credentials and a reachable HTTPS callback.
2. Decide whether checkout's half-up rounding policy should also govern fractional supplier receipt/return costs, which remain exact-only.
3. Complete SMTP delivery and the remaining [security verification checklist](SECURITY_VERIFICATION.md), then separately prove HostPinnacle runtime/database/TLS/jobs, phone access and backup/restore.

## Git and deferred hosting

The walkthrough and authorization-boundary correction are committed at `20f49f3`; the dashboard refresh is committed at `bb170d8`; the purchase-report contract is committed at `6d8c9ee`; fractional sale/refund rounding is committed at `1b84914`. The durable external-payment foundation and this handoff update are uncommitted; no commit or push was requested. Private environment files and generated builds remain ignored.

HostPinnacle target: `https://dev.sifulabs.co.ke/`. Earlier panel evidence showed Node 22.23.2 starting successfully, dependency installation failing under allocation limits, and a later application-lock error. Preserve `backend/app.cjs`, packaging scripts and [the deployment runbook](HOSTPINNACLE_DEPLOYMENT.md); hosted state is still unknown.
