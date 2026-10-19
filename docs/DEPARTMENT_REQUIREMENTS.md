# POP N GO branches, departments and access

**User decisions, 16 October 2026:** two separate physical tills; Minimart and Liquor have separate stock. Cashiers normally work in one home department with exceptional cover. Cashiers and supervisors may add products but cannot maintain existing products. Cashier reductions/removals require supervisor or manager approval; ordinary additions/increases do not. Branch names and the expiry warning period are entered in Settings, not guessed.

## Implemented setup

1. Sign in as a manager with verified MFA. Open **Account settings → Business**.
2. Add each actual branch. Each receives POP N GO Minimart and POP N GO Liquor departments and one till per department. No branch is seeded by migration.
3. Set the expiry warning period (0–365 days). Until configured, only already-expired stock is alerted.
4. Create actual staff accounts through **Staff accounts**. Supervisors must enroll MFA before operational access or password approvals.
5. Assign a home department. Optional cover has an explicit expiry chosen by the manager; saving without cover revokes previous cover. Close open shifts before changing assignments. Settings includes manager drawer closure with actual counted cash for expired-cover or legacy shifts.
6. Review **Assign existing stock**. Assign each unassigned product and its current balance once, with a reason. Historical sales stay unassigned. The list shows up to 100 at a time and refreshes after assignment. Assigned products cannot be moved through this action.
7. Choose branch/department and till from the compact header, then open the register. New products inherit the selection. Cashiers see only home/valid-cover departments; forged selections are refused server-side.

The API scopes catalogue/barcode/photo access, balances/history, basket quotes, saved/held orders, checkout, returns, purchasing, counts, shifts and operational reports. Writes recheck grants transactionally before replay. Completed sales retain department/till IDs; purchases and held orders retain department IDs. Only one open shift per physical till is allowed. Manager combined reporting retains unassigned historical sales separately. SKU/barcode uniqueness is per department, so the same packaged item can exist in several branches with separate product identities and balances. Unassigned legacy codes remain unique until reviewed. Stock transfers are not implemented. Legacy unassigned sales remain read-only for departmental returns/payments; resolve pending transactions before upgrade and review historical exceptions before operational use.

## Approval and permissions

A versioned basket is saved per staff member/department. Refreshing or submitting a smaller checkout payload cannot remove saved items. Cashier reductions/removals/clearing and held-order cancellation require supervisor/manager email, password and reason. The approver must be active, verified and MFA-enrolled; supervisors need department access. Persistent rate limits survive failed transactions. Permissions and password changes are rechecked inside the transaction. Approval and before/after basket details are audited without passwords. Checkout/holding consume the exact saved basket atomically; resuming restores it atomically. This does not create a manager session for the cashier.

Supervisors have sales, own shifts/held orders, department returns, product creation and departmental daily summaries. Existing-product changes/archive, categories, imports, photos, stock maintenance, staff administration, settings and broader reports remain manager-only. No product-delete endpoint exists.

## Expiry and reports

Products have an optional **next expiry date**, representing the earliest expiry on stocked units. Managers update it after those units are removed. It is not a lot/batch ledger. Dashboard alerts include active products with positive stock, use Africa/Nairobi dates and the configured window, and show the earliest 20 plus a total count. Expired goods are not automatically blocked at checkout.

Managers have a **Daily summary** date picker and combined/departmental daily sales cards. Supervisors can open their department summary. Collected payments and recorded sales are separate. Moving weighted average was selected by the user on 17 October. Dashboard and Business Settings show current known stock value, unvalued product counts, daily net COGS and gross profit by department, plus combined values. Profit stays unavailable if any sale/return cost for that day is missing. These are sales gross profits, excluding stock-adjustment losses and supplier-credit differences. Legacy offline projections are not included in the cost ledger.

## Migration and operating limits

`202610160001_business_structure.sql` adds roles, branches/departments/tills, grants, nullable attribution and expiry. `202610160002_register_baskets.sql` adds saved baskets. `202610160003_department_codes.sql` scopes SKU/barcode uniqueness and protects assigned product ownership. `202610170001_refund_drawer_movements.sql` adds unique refund-to-cash-out links without guessing historical payout drawers. `202610170002_moving_average_costs.sql` adds the append-only cost ledger and average-cost pools; existing positive balances start unvalued. No historical inventory or sales are silently allocated. Back up, resolve pending transactions and close shifts before migration/setup. Managers must configure branches/access before cashiers trade. Rollback is destructive and refuses to remove supervisor support while such accounts exist.

This setup targets hosted operation. The legacy one-PC offline bootstrap/configuration transport and projections do not carry scope or supervisor. Bootstrap writes are refused once branches/supervisors exist. Department reports exclude unscoped synchronized records; legacy synchronized documents require the combined overview. Do not cut over this setup or run two independent offline stock writers. Extend and verify signed transport/local authority before claiming offline support.

Cash returns now require a fully cash-paid sale and the operator's open shift on the selected till. Stock restoration, refund and a unique linked cash-out movement commit atomically; retries return the original payout. External-payment and unpaid sales cannot use this cash-payout route. Historical refund drawers are not backfilled. Physical sale/refund/count/close rehearsal remains required before an operational pilot.

Credentials alone do not verify M-Pesa callbacks, reconciliation or live readiness. No Dukan/iPOS subscription or hardware purchase has been made.

## Opening costs and moving averages

After configuring branches and reviewing stock allocation, select the department in the header. In Account settings → Business → Opening stock valuation, choose an unvalued product and enter the total acquisition value of its current balance in KES, with an invoice/review reason. The server rejects stale quantities and already-valued balances; retries preserve the original request. No historical sale costs are rewritten. Zero must mean genuinely free stock, not unknown cost.

Priced purchase receipts add their exact recorded total to stock value. Withdrawals allocate the current book value proportionally, rounded to the nearest minor unit with exact halves up; full depletion removes the remaining value. Original cost snapshots remain immutable. Partial customer returns restore cumulative proportions of that original cost, even after another delivery changes the average. Adjustment/count gains use the current average when available; losses and supplier returns withdraw average cost. Unpriced receiving/opening stock makes the balance unvalued until reviewed; depletion to zero resets the pool. The existing supplier rule still rejects fractional purchase totals in minor units rather than guessing a rounding policy.
