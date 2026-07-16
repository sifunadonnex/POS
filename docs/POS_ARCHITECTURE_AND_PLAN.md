# Pay & Go POS — Architecture and Delivery Plan

**Status:** Draft for project planning  
**Version:** 0.1  
**Last updated:** 16 July 2026  
**Initial assumption:** One supermarket in Kenya, with multiple tills and future support for multiple branches.

## 1. Purpose

This document is the working technical and product reference for the Pay & Go supermarket point-of-sale system. It records the proposed architecture, core business rules, modules, integrations, security controls, delivery phases, and decisions that must be confirmed before implementation.

Update this document whenever an architectural decision changes. Detailed user stories and screen-level acceptance criteria should be maintained in a separate Product Requirements Document (PRD).

## 2. Product goals

Pay & Go should:

- Give cashiers a fast, simple checkout experience on Windows computers.
- Continue processing permitted sales when the store internet connection fails.
- Give the owner or manager a responsive web dashboard accessible from a phone or computer.
- Maintain accurate and auditable sales, payments, stock, purchasing, and cashier records.
- Integrate with M-Pesa and KRA eTIMS.
- Support thermal printers, barcode scanners, cash drawers, and payment terminals.
- Start with one supermarket but allow branches and additional tills without a redesign.
- Protect business, employee, and customer data.

## 3. Key architecture decision

Use a **hybrid, offline-capable architecture** consisting of:

1. A Windows cashier application at each till.
2. A local store edge server and database on the store network.
3. A cloud platform for centralized data, integrations, backups, and reporting.
4. A responsive manager web application for phones and computers.

Use a **modular monolith**, not microservices, for the initial system. Modules should have clear boundaries, but should be deployed as one backend application. This reduces operational cost and complexity while leaving a clean path to separate a module later if scale proves that it is necessary.

## 4. System context

```text
SUPERMARKET
┌────────────────────────────────────────────────────┐
│ Cashier computers                                  │
│                                                    │
│ ┌──────────────────┐       ┌──────────────────┐    │
│ │ POS Till 1       │       │ POS Till 2       │    │
│ │ Desktop client   │       │ Desktop client   │    │
│ │ Local fallback   │       │ Local fallback   │    │
│ └─────────┬────────┘       └─────────┬────────┘    │
│           │ Store LAN                │             │
│ ┌─────────▼──────────────────────────▼───────────┐ │
│ │ Store Edge Service                            │ │
│ │ Checkout API, stock, prices, receipt sequence │ │
│ │ Local PostgreSQL and synchronization outbox   │ │
│ └──────────────────────┬─────────────────────────┘ │
│                        │ Fibre with 4G/5G failover │
└────────────────────────┼───────────────────────────┘
                         │ Encrypted synchronization
┌────────────────────────▼───────────────────────────┐
│ CLOUD PLATFORM                                     │
│                                                    │
│ API and business rules                             │
│ Cloud PostgreSQL, background jobs, audit, backups  │
│                                                    │
│ ┌─────────────────────┐  ┌───────────────────────┐ │
│ │ Manager web app     │  │ Integration adapters  │ │
│ │ Phone and computer  │  │ M-Pesa, eTIMS, SMS    │ │
│ └─────────────────────┘  └───────────────────────┘ │
└────────────────────────────────────────────────────┘
```

### 4.1 Responsibilities

| Component | Main responsibilities |
| --- | --- |
| Cashier desktop client | Scanning, basket interaction, payment capture, receipt and cash-drawer control, local emergency queue |
| Store edge service | Local checkout API, current branch prices and stock, till sessions, receipt sequences, offline operation, cloud synchronization |
| Cloud backend | Central business rules, master data, consolidated reporting, integrations, administration, backup and monitoring |
| Manager web app | Sales and stock dashboards, approvals, configuration, reports, alerts and reconciliation |
| Integration workers | Reliable processing of M-Pesa, eTIMS, notifications, exports and retry queues |

The manager dashboard must display whether branch data is **Live**, **Syncing**, or **Last synchronized at [time]**. Stale data must never look real-time.

## 5. Proposed technology stack

| Layer | Default choice | Notes |
| --- | --- | --- |
| Cashier UI | React + TypeScript | Shared component and validation packages with the web app |
| Cashier desktop shell | Tauri | Local device access and a smaller footprint than a full browser bundle |
| Manager web app | Next.js/React responsive PWA | Optimized for phone and desktop browsers |
| Backend | NestJS + TypeScript | Modular application with a documented REST API |
| Primary databases | PostgreSQL | Separate store and cloud instances |
| Till emergency storage | Encrypted SQLite queue | Only for controlled fallback if the edge service is temporarily unavailable |
| Background jobs | PostgreSQL jobs initially; Redis/BullMQ if needed | Do not introduce Redis until queue volume or scheduling requires it |
| File storage | S3-compatible object storage | Exports, imports, and supporting files |
| Deployment | Docker + managed cloud services | Separate development, staging, and production environments |
| Observability | Structured logs, error tracking, metrics and uptime checks | Include sync, payment, eTIMS and backup alerts |

If the delivery team is substantially stronger in Python, Django may replace NestJS without changing the architecture. The final stack decision should follow a short proof of concept covering printing, scanning, offline synchronization, and deployment.

## 6. Application modules

### 6.1 Identity and access

- Users, roles, branches, tills, and device registrations.
- Roles: Cashier, Supervisor, Stock Clerk, Purchasing Officer, Accountant, Branch Manager, Owner/System Administrator.
- Branch-scoped and action-level permissions.
- Short cashier PIN for till switching and approvals; strong passwords and multi-factor authentication for managers and administrators.
- Session timeout, device revocation, and account locking.

### 6.2 Product catalogue and pricing

- Products, categories, brands, units of measure, and multiple barcodes.
- Cost price, selling price, VAT/tax classification, and effective dates.
- Branch-specific price lists.
- Scheduled promotions, minimum price, and maximum discount controls.
- Weighted and variable-price products where required.
- CSV/Excel import with validation and an error report.

### 6.3 Checkout and sales

- Fast barcode scanning and keyboard-first operation.
- Product search, quantities, discounts, and supervisor overrides.
- Hold and resume baskets.
- Cash, M-Pesa, card, and split payments.
- Receipt printing, reprinting, and digital receipt option.
- Returns, refunds, voids, and credit notes.
- Automatic stock movements and fiscal-document submission.

Paid sales are immutable. A correction must create a linked void, return, refund, or credit note. It must never silently update or delete the original sale.

### 6.4 Inventory

Inventory must use an append-only **stock movement ledger**. Do not treat a directly editable `quantity_on_hand` column as the source of truth.

Movement types include:

- Opening balance
- Supplier receipt
- Sale
- Customer return
- Wastage or damage
- Stocktake adjustment
- Branch transfer
- Supplier return

Batch and expiry tracking should be optional per product. A calculated stock-balance table may be maintained for performance, but it must be rebuildable from the ledger.

### 6.5 Purchasing

- Suppliers and supplier products.
- Purchase orders and approval status.
- Goods received notes.
- Supplier invoices and purchase returns.
- Partial receipt handling.
- Cost history and margin calculation.
- Reorder suggestions based on minimum stock and sales velocity.

### 6.6 Payments and reconciliation

- Payment attempts separated from completed payments.
- Unique provider and internal references.
- Idempotent callbacks and retries.
- Daily M-Pesa, card, and cash reconciliation.
- Exception queue for missing, duplicated, underpaid, or overpaid transactions.
- No card PAN, CVV, or PIN stored by Pay & Go.

### 6.7 Cash and shift management

- Opening float and cashier shift.
- Cash-in and cash-out with reasons and authorization.
- Expected versus counted cash.
- Variance reporting and sign-off.
- X report during a shift and Z report at closing.
- Till and branch daily closing.

### 6.8 Reporting and manager dashboard

- Sales today, this week, this month, and custom period.
- Sales by branch, till, cashier, product, category, and payment method.
- Gross profit estimate and price/cost changes.
- Current, low, negative, and out-of-stock items.
- Expiry and slow-moving product reports.
- Refund, void, discount, override, and cash-variance reports.
- Supplier and purchasing reports.
- M-Pesa, eTIMS, device, and synchronization status.
- CSV, Excel, and PDF export.

### 6.9 Audit and notifications

- Append-only audit events for authentication and sensitive business actions.
- Actor, time, branch, till/device, reason, previous value, and new value where applicable.
- Alerts for unusual discounts, excessive voids, negative stock, failed sync, failed backups, failed eTIMS submission, and unreconciled payment.

## 7. Core data model

The initial model should include at least:

- `organizations`, `branches`, `devices`, `tills`
- `users`, `roles`, `permissions`, `user_branch_roles`
- `products`, `product_barcodes`, `categories`, `units`
- `tax_categories`, `price_lists`, `product_prices`, `promotions`
- `suppliers`, `purchase_orders`, `goods_receipts`, `supplier_invoices`
- `stock_locations`, `stock_movements`, `stock_balances`, `stocktakes`
- `till_sessions`, `cash_movements`
- `sales`, `sale_lines`, `payment_attempts`, `payments`
- `returns`, `return_lines`, `refunds`
- `fiscal_documents`, `etims_submissions`
- `sync_outbox`, `sync_inbox`, `sync_checkpoints`, `sync_conflicts`
- `audit_events`, `notifications`

### 7.1 Data rules

- Use UUIDv7 or another sortable globally unique ID for distributed records.
- Store money as integer minor units, never floating-point values.
- Store quantities as fixed-precision decimals.
- Store timestamps in UTC and retain the branch timezone for display and business-day calculations.
- Record tax, price, cost, and product description snapshots on sale lines. Historical receipts must not change when a product is edited.
- Use database transactions for sale, payment, stock, audit, and outbox writes.
- Add optimistic version fields to mutable master data.

## 8. Sale and payment state model

A sale should follow an explicit state machine, for example:

```text
DRAFT
  └─> AWAITING_PAYMENT
        ├─> PAYMENT_FAILED ─> AWAITING_PAYMENT
        └─> PAID
              └─> FISCAL_PENDING
                    ├─> FISCAL_FAILED (retry/exception queue)
                    └─> COMPLETED

COMPLETED ─> RETURN/VOID/CREDIT NOTE (new linked document)
```

Exact fiscal timing and what may be printed during an outage must be confirmed with the chosen eTIMS integration method before this state machine is finalized.

## 9. Offline operation and synchronization

### 9.1 Authority model

- The store edge service is operationally authoritative for local sales while disconnected.
- The cloud is authoritative for consolidated master data, administration, and reporting.
- Completed transactional records are immutable and replicated, not merged by overwriting.
- Master-data changes use versions and effective dates.

### 9.2 Synchronization pattern

1. A business operation and its outbox event are committed in one local database transaction.
2. A synchronization worker sends pending events to the cloud.
3. The cloud records the message ID in an inbox before applying it.
4. Repeated messages return the original result instead of creating duplicates.
5. The branch records the acknowledgement and advances its checkpoint.
6. Failed messages retry with exponential backoff.
7. Non-automatic conflicts enter a visible resolution queue.

### 9.3 Offline restrictions

- Cash sales may continue when the internet is unavailable, subject to the confirmed eTIMS procedure.
- A digital payment must not be marked successful solely because a request was initiated.
- Management changes that cannot be safely reconciled should be disabled while offline.
- Every offline receipt and transaction must have a locally unique sequence and globally unique ID.
- The UI must display offline state and the number of queued operations.

## 10. External integrations

### 10.1 M-Pesa

Use Safaricom Daraja APIs. The integration must record:

- Internal sale and payment-attempt IDs
- Checkout/request ID
- M-Pesa receipt number
- Requested and received amount
- Masked customer phone number
- Callback payload and timestamps
- Confirmation and reconciliation status

Only a successful callback or a verified reconciliation result may confirm the payment. Callback processing must be idempotent, authenticated where supported, logged, and safe to retry.

Reference: [Safaricom Daraja developer portal](https://developer.safaricom.co.ke/apis)

### 10.2 Card payments

Use a certified bank or payment-provider terminal. Pay & Go should store only the provider reference, amount, terminal, result, and reconciliation status. It must not store card numbers, CVV, or PIN data.

Reference: [PCI DSS document library](https://www.pcisecuritystandards.org/document_library/)

### 10.3 KRA eTIMS

The likely solution is system-to-system integration through OSCU or VSCU. KRA describes VSCU as suitable for invoicing systems that do not always operate online. The project should use a currently certified third-party integrator for the first release unless there is a documented business case for undertaking self-integration and certification.

The internal eTIMS adapter must retain:

- Request and response payloads
- Internal and KRA invoice identifiers
- Signature, QR, tax, sequence, and status information
- Attempts, errors, next retry time, and reconciliation state
- Links between original invoices and credit notes

The exact offline invoicing, receipt issuance, retry, and credit-note procedure must be signed off with KRA or the selected certified integrator before checkout development is considered complete.

References:

- [KRA eTIMS overview](https://www.kra.go.ke/online-services/etims)
- [KRA eTIMS solution guidance](https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/types-of-etims-solutions)
- [KRA system-to-system information](https://etims.kra.go.ke/main/signup/indexLearnMore)

### 10.4 Accounting and messaging

Accounting export, SMS, email, and WhatsApp are later adapters behind internal interfaces. No checkout transaction should depend synchronously on a messaging service.

## 11. Security, privacy, and compliance

- TLS for all network traffic.
- Encryption at rest for databases, backups, and till fallback queues.
- Multi-factor authentication for manager and administrator accounts.
- Role- and branch-based authorization enforced on the server.
- Manager reauthentication for refunds, large discounts, price overrides, and sensitive exports.
- Automatic till locking and device/session revocation.
- Rate limiting, login throttling, and secure password hashing.
- Secrets stored in a managed secrets facility, never in source control.
- Append-only audit trail for sensitive actions.
- Automated dependency, static-analysis, and vulnerability scans.
- Separate development, staging, and production data and credentials.
- Daily backups, point-in-time recovery, off-site copies, and quarterly restore drills.
- Customer data minimization, documented retention, and controlled exports.

Use OWASP ASVS 5.0 as the application-security verification baseline. Use PCI DSS v4.0.1 requirements where the selected card-payment flow places Pay & Go in scope.

Because the system may process employee, supplier, loyalty, and customer information, assess registration and other obligations under Kenya's Data Protection Act and ODPC guidance before production.

References:

- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)
- [Kenya Data Protection Act](https://new.kenyalaw.org/akn/ke/act/2019/24)
- [ODPC compliance guidance](https://www.odpc.go.ke/data-protection-compliance/)

## 12. Hardware and store network

Each checkout lane should have:

- Supported Windows 11 computer
- USB barcode scanner
- 80 mm ESC/POS thermal receipt printer
- Cash drawer connected through the printer
- Customer display, if required
- Separate certified card terminal, if cards are accepted
- Label printer, if required
- UPS

The store should have:

- A dedicated edge-server mini PC rather than a cashier's workstation acting as the server
- Business-grade router and network switch
- Primary fibre connection with automatic 4G/5G failover
- UPS for edge server, router, switch, and tills
- Separate staff/guest Wi-Fi from the POS network
- Documented replacement and recovery procedure for the edge server

## 13. Environments, deployment, and operations

- `development`: local developer data and simulated integrations.
- `staging`: production-like environment using provider sandboxes.
- `production`: restricted access, monitored backups, and controlled releases.

Use automated migrations and backward-compatible deployments. Edge releases must support staged rollout, health checks, rollback, and remote diagnostics. A till must not update itself in the middle of an open transaction or cashier shift without explicit control.

Operational dashboards should monitor:

- API error and response rates
- Edge and till heartbeat
- Synchronization lag and queue depth
- M-Pesa callback age and reconciliation exceptions
- eTIMS failure and retry count
- Database capacity and replication health
- Backup success and last verified restore
- Printer/device errors where observable

## 14. Delivery plan

### Phase 0 — Discovery and validation (1–2 weeks)

- Observe checkout, receiving, stocktake, return, and closing workflows.
- Confirm product count, daily transaction volume, number of tills, and future branches.
- Confirm hardware, weighted products, customer credit, loyalty, and expiry requirements.
- Confirm M-Pesa shortcode type, card provider, VAT setup, and current eTIMS arrangement.
- Produce the PRD, wireframes, threat model, data model, and acceptance tests.
- Build a proof of concept for scanner, printer, cash drawer, and offline sync.

### Phase 1 — Platform foundation (2 weeks)

- Repository, CI/CD, environments, monitoring, and backup setup.
- Users, roles, branches, tills, and device registration.
- Product catalogue, prices, taxes, imports, and audit logging.
- Cloud and edge database foundations.

### Phase 2 — Checkout MVP (3 weeks)

- Barcode checkout and product search.
- Cash payments, receipts, hold/resume, and cashier shifts.
- Returns, voids, and supervisor approvals.
- Local edge service, outbox, idempotency, and offline indicators.

### Phase 3 — Inventory and purchasing (3 weeks)

- Stock ledger, balances, adjustments, and stocktake.
- Suppliers, purchase orders, goods receipts, and purchase returns.
- Low-stock, cost, and margin reporting.

### Phase 4 — Integrations and manager dashboard (3–4 weeks)

- M-Pesa initiation, callbacks, and reconciliation.
- eTIMS adapter, sandbox testing, failure queue, and fiscal documents.
- Responsive phone dashboard, alerts, reports, and exports.
- Card payment references and reconciliation if required.

### Phase 5 — Pilot and launch (2 weeks)

- Product and opening-stock migration.
- Install and pilot on one till.
- Run controlled parallel checks against the current process.
- Train cashiers, supervisors, stock staff, and managers.
- Test power, internet, edge, printer, payment, and eTIMS failures.
- Reconcile sales, payments, stock, tax, and till closing.
- Roll out to remaining tills only after pilot exit criteria are met.

**Planning estimate:** 12–16 weeks for an experienced team of three or four people. Provider onboarding, data cleanup, hardware delays, or eTIMS certification/integration may extend the schedule.

## 15. MVP scope

The first production release includes:

- Products, categories, units, barcodes, prices, and VAT
- Product import
- Checkout and receipt printing
- Cash and M-Pesa payments
- Returns, refunds, and voids
- Stock ledger, receiving, adjustments, and stocktake
- Suppliers and basic purchasing
- Till opening, cash movement, closing, and variance
- User roles, supervisor approvals, and audit logs
- Responsive manager dashboard and core reports
- Edge service, offline cash operation, and cloud synchronization
- eTIMS integration
- Automated backups, monitoring, and recovery documentation

Deferred unless discovery makes them essential:

- Loyalty points and customer accounts
- Customer credit and lay-by
- Advanced promotion engine
- E-commerce and delivery orders
- Accounting-system integration
- Advanced forecasting
- Multi-branch transfers
- Employee scheduling and payroll

## 16. Acceptance and service targets

- A scanned item appears in the basket in under one second on the store LAN.
- A normal cash checkout completes within five seconds excluding customer handling time.
- The system supports at least one full business day of permitted offline cash sales.
- Retried synchronization cannot duplicate a sale, payment, stock movement, or fiscal document.
- The phone dashboard updates within one minute while the branch is online.
- Every refund, void, discount, stock adjustment, and cash movement identifies the user and reason.
- A paid sale cannot be silently edited or deleted.
- Branch users cannot access unauthorized branch data.
- Backup failures alert the responsible operator.
- A documented restore drill successfully recreates the cloud system and a store edge server.
- Pilot reconciliation produces no unexplained sale, payment, tax, or stock differences.

Performance targets must be load-tested using the confirmed product and transaction volumes before they become contractual service levels.

## 17. Testing strategy

- Unit tests for pricing, taxes, payments, stock, and permissions.
- Database integration tests for transaction and ledger invariants.
- Contract tests for M-Pesa and eTIMS adapters.
- End-to-end tests for checkout, refund, shift closing, and receiving.
- Hardware tests using the actual scanner, printer, drawer, and terminal models.
- Failure-injection tests for internet loss, duplicate callbacks, delayed callbacks, service restart, full disk, and power interruption.
- Synchronization property tests proving idempotency and ordering behavior.
- Permission and tenant/branch-isolation tests.
- Security review against OWASP ASVS.
- Backup restoration and disaster-recovery drills.
- Cashier usability testing with real product scanning.

## 18. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Internet outage stops sales | Store edge service, local database, 4G/5G failover, UPS |
| Duplicate M-Pesa callbacks/payments | Idempotency keys, unique provider references, reconciliation |
| Stock differs between reports and shelves | Append-only stock ledger, controlled adjustments, regular stocktakes |
| Cashier fraud or untraceable changes | Least privilege, supervisor approval, immutable audit, exception reports |
| eTIMS outage or rejected invoice | Adapter queue, retry policy, visible exception workflow, certified integrator |
| Edge-server failure | Dedicated hardware, UPS, monitored backups, documented replacement restore |
| Corrupt or duplicated offline data | Transactional outbox/inbox, unique IDs, checksums, replayable events |
| Scope expands before checkout is stable | Enforce MVP boundaries and phase-gate later features |
| Sensitive data exposure | Data minimization, encryption, access control, secure exports, retention policy |
| Hardware incompatibility | Proof of concept and approved hardware list before bulk purchase |

## 19. Open decisions before development

These must be answered during Phase 0:

1. How many branches and tills exist now, and what is the three-year target?
2. How many products and transactions are expected per day?
3. Which Windows computers, scanners, printers, drawers, scales, and card terminals already exist?
4. Does the supermarket sell weighed, fractional, batch-controlled, or expiry-controlled products?
5. Which payments are required: cash, M-Pesa Till/PayBill, cards, vouchers, customer credit, or split tender?
6. What is the current KRA eTIMS solution and who is the approved integrator?
7. Must prices include VAT, and which product tax categories are used?
8. Are loyalty, customer records, delivery, wholesale pricing, or credit required in the MVP?
9. Who may change prices, discount, refund, void, adjust stock, or reopen a closed shift?
10. Which accounting package, if any, must receive exports?
11. What reports does the manager currently use to run the business each day?
12. What internet and power outage duration must the store withstand?
13. Where will cloud data be hosted, and what data-location/privacy constraints apply?
14. Who owns production operations, support, backups, hardware replacement, and incident response?

## 20. Project decision log

Record major decisions here or in separate Architecture Decision Records (ADRs).

| ID | Decision | Status | Date |
| --- | --- | --- | --- |
| ADR-001 | Use hybrid store-edge plus cloud architecture | Proposed | 2026-07-16 |
| ADR-002 | Use a modular monolith for the initial backend | Proposed | 2026-07-16 |
| ADR-003 | Use an append-only stock movement ledger | Proposed | 2026-07-16 |
| ADR-004 | Use a desktop shell for tills and a responsive web app for managers | Proposed | 2026-07-16 |
| ADR-005 | Use a certified eTIMS integrator for the first release | Proposed | 2026-07-16 |

## 21. Definition of project success

The project succeeds when store staff can complete daily checkout, receiving, returns, stock control, and till closing accurately; management can monitor the business remotely; sales remain safe during defined outages; every important action is auditable; M-Pesa and eTIMS reconcile; and the system can be restored from tested backups without losing committed transactions.
