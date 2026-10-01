# BizFlow demo gap analysis

**Reviewed:** 1 October 2026  
**Reference:** <https://demo.bizflow.ke/outlet/demo-outlet-shop/quick-actions>

This is a read-only comparison of the visible BizFlow shop demo with the
current Pay & Go source and handoff. It is a planning aid, not an endorsement
of the demo's data model or accounting claims. Items below are proposals until
the user selects scope.

## Executive finding

Pay & Go already has the harder safety foundations that should be preserved:
server-authoritative pricing, exact minor-unit arithmetic, replay-safe writes,
append-only stock movements, cash reconciliation, durable external-payment
attempts, real post-sale returns, role enforcement, and PostgreSQL-backed
reports.

The largest gap is operational breadth around those foundations. BizFlow makes
orders, customers, supplier obligations, expenses, shift reports, stock alerts,
taxes, printers and device settings visible as first-class workflows. Pay & Go
currently has a smaller but safer core and needs the following additions in a
deliberate order.

## Priority 0: complete before calling the system live-ready

| Gap                                      | Current Pay & Go state                                                                                                                                                                                                                                             | Recommended outcome                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Searchable order/sales ledger            | The first slice was completed on 1 October 2026: a paged date/search ledger, role-scoped cashier access and sale/payment detail are server-backed. Customer/status/payment filters, immutable sale snapshots, receipt reprint and refund links remain.             | Complete the remaining filters and links after immutable sale-line snapshots are agreed; keep authorization and paging server-side.                                                            |
| Durable suspended orders/tabs            | Completed on 1 October 2026: held orders are server-backed, replay-safe, role-scoped, and retain ownership, notes, immutable lines and terminal resume/cancel history. Holding does not reserve stock or prices.                                                   | Keep server records authoritative and revalidate active products, current prices and stock after resume. Add an optional device crash-recovery draft only if field testing shows a need.       |
| Discounts and approval controls          | No discount model is stored on sale lines.                                                                                                                                                                                                                         | Add line/order discounts, reason capture, manager approval limits, immutable discount snapshots and report totals. Do not implement discounts only in the UI.                                  |
| Split-tender checkout                    | Backend payment writes prevent overpayment and can record partial payments, but the register explicitly says split payments are not enabled.                                                                                                                       | Add a guided split-tender UI for cash/M-Pesa/card when available, exact remaining balance, tender/change rules and recovery for pending external payments.                                     |
| Sale-line accounting snapshots           | Sale lines currently store product ID, quantity, unit price and line total, but not immutable SKU/name, tax, discount or cost basis.                                                                                                                               | Snapshot description/SKU, applied tax class/rate/amount, discount and the agreed cost basis on every finalized line. Historical receipts and reports must not depend on today's catalogue row. |
| Costing, inventory value and real margin | Purchase lines record supplier unit cost, but no selected cost-flow method allocates cost to sales. Reports correctly avoid claiming profit.                                                                                                                       | Decide the supplier-cost rounding rule and costing method (initial recommendation: weighted average), maintain inventory value, snapshot COGS at sale time, then report gross margin.          |
| Tax and fiscal handling                  | Products have a free-text tax code, but checkout does not calculate/snapshot tax classes. Live eTIMS remains undecided.                                                                                                                                            | Add managed tax classes, inclusive/exclusive policy, sale-line tax snapshots, tax reports and a separately verified eTIMS workflow before fiscal claims.                                       |
| Low-stock controls                       | Completed on 1 October 2026: active products can define unit-aware low-stock thresholds; stock reads expose the alert state and the manager dashboard shows a count plus a prioritized alert list. Products without thresholds and archived products are excluded. | Keep the current at-or-below rule and catalogue history authoritative. Add a direct purchase-intake shortcut or reorder suggestions only after the shop confirms its replenishment workflow.   |
| Shift and drawer operations              | Opening float, confirmed cash movements, closing count and variance exist. Manual paid-in/paid-out, shift history and a detailed close report do not.                                                                                                              | Add controlled cash-in/out, open/closed shift history, cashier close report, manager variance review and printable X/Z-style summaries.                                                        |
| Unified critical audit                   | Authentication/staff security and catalogue history are audited, while business reasons are distributed across transaction records.                                                                                                                                | Add one append-only, manager-readable critical-action feed for discounts, voids, returns, stock adjustments, shift overrides, supplier changes and configuration changes.                      |
| Export and recovery operations           | Reports are on-screen only. Hosted backup/restore, SMTP delivery and production runtime remain unverified.                                                                                                                                                         | Add CSV/print-to-PDF exports with applied filters; separately prove scheduled backups, restore, hosted jobs/TLS, SMTP and operational recovery.                                                |

## Priority 1: high-value manager and credit workflows

| Gap                                          | Why it matters                                                                                                                                  | Suggested scope                                                                                                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer directory                           | The demo connects orders, invoice balances and credit limits to customers. Pay & Go has no customer entity.                                     | Customer contact record, sale association, order history and optional credit limit. Avoid loyalty/promotions until the basic ledger is trustworthy.                                                                   |
| Supplier master and obligations              | Pay & Go has supplier names, receipt/return history and reconciliation, but not contacts, invoice references, due dates or payments.            | Extend suppliers with contact details; add supplier bill/reference, due date, status and append-only payment allocation.                                                                                              |
| Expenses and approvals                       | Without expenses, a P&L cannot represent operating profit.                                                                                      | Expense categories, receipt attachment policy, staff request/manager approve-reject flow and shift/period attribution.                                                                                                |
| Proper P&L and margin reports                | BizFlow exposes P&L and per-work margins, but its visible demo P&L adds sales and direct invoices then subtracts expenses without showing COGS. | Build gross sales, returns, discounts, tax, COGS, gross margin, operating expenses and net operating result as separately labelled figures. Never label revenue minus expenses as product profit when COGS is absent. |
| Configurable payment methods and collections | Pay & Go currently fixes cash/card/M-Pesa in code; card is disabled and Daraja awaits sandbox verification.                                     | Manager-visible method availability, bank/credit only if required, reference rules, a payment collections ledger and settlement/reconciliation exports. Provider credentials remain server-only.                      |
| Quotations and customer invoices             | Useful for B2B/credit customers, but not necessary for a simple walk-in shop.                                                                   | Add only after customers, taxes and payment allocation: draft/sent/approved/paid/cancelled states, due dates, PDF export and quotation-to-invoice conversion.                                                         |
| Rich report navigation                       | Current sales insights already covers daily net sales, refunds, cashier performance, payment mix and top products.                              | Add hourly/shift presets, order drill-down, saved filter defaults and exports. Keep charts responsive and tables accessible.                                                                                          |

## Priority 2: add only when the shop model requires it

- Multiple outlets or departments with scoped stock, prices, staff and reports.
- Recipe/component stock depletion for a cafe, bakery or assembled products.
- Subscriptions or recurring orders.
- Device registry and per-device POS preferences.
- Multiple printer profiles, kitchen/order printers and an ESC/POS bridge.
- Product folders beyond the existing category model.
- Advanced promotions, loyalty, batch/expiry tracking and stock transfers.

These features are valuable in the right business, but adding them to a
single-outlet retail pilot before the transaction and accounting foundations
would increase risk and operator complexity.

## Useful BizFlow interaction patterns to adopt selectively

- A searchable command palette for fast navigation and record lookup.
- Consistent table filters, sorting, column visibility, page size and clear
  empty states.
- Contextual drill-down from summary metrics to the underlying orders or
  payments.
- One manager settings area for outlet identity, currency, tax, payments,
  receipts and hardware.
- Clear feature states: active, hidden, unavailable, pending, paid, outstanding
  and cancelled.

Pay & Go should keep its simpler role-specific navigation and add these
patterns only where the data and action are real. No placeholder module should
be exposed as if it works.

## What not to copy blindly

- The demo's visible **Returns** page tracks removals from open bills. Pay & Go's
  completed-sale return/refund workflow is more appropriate for customer
  refunds and should remain separate from voiding an unsettled line.
- The demo's visible **P & L** is not evidence of a complete accounting model;
  it does not visibly deduct product cost from sales. Pay & Go should wait for
  an agreed cost method and sale-time cost snapshots before claiming profit.
- Device-local settings, generic payment methods and many configurable columns
  can improve flexibility, but they also create support and permission surface.
  Add them in response to an actual shop workflow.
- Multi-outlet, departments, recipes and subscriptions are growth features,
  not prerequisites for the current single-shop pilot.

## Recommended delivery sequence

1. Decide supplier fractional-cost rounding, costing method, tax policy and
   discount approval rules; add immutable sale-line snapshots.
2. Searchable sales ledger and server-persisted suspended orders completed.
3. Enable split tender and discounts in the register with authorization and
   recovery coverage.
4. Low-stock thresholds and dashboard alerts completed; add inventory
   valuation, shift history/manual drawer movements and unified critical logs.
5. Add exports, supplier obligations and expenses; then release real P&L and
   margin reports.
6. Add customers, quotations and invoices if credit/B2B trading is confirmed.
7. Add hardware/device, department, recipe, subscription or multi-outlet work
   only when the target shop requires it.

Daraja sandbox/callback verification, SMTP delivery, hosted runtime checks,
backup/restore and the fiscal decision remain parallel release gates rather
than substitutes for this feature sequence.
