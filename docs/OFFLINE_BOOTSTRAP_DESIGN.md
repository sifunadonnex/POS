# Hosted-to-edge bootstrap design

**Status:** Design and first guard/checkpoint slice, 3 October 2026. Hosted
operational writes are guarded after an internal cutover transition, edge
staff/catalogue API writes are blocked, and a durable single-store generation
and configuration checkpoint exists. No active store has been registered or
cut over. Snapshot transfer, credential enrollment, opening-count signoff and
generation-aware event delivery are not implemented. This document defines
the remaining build and acceptance checks for the single-PC, single-store
pilot. [Edge setup](OFFLINE_EDGE_SETUP.md) describes the working cash-sale
event path.

## Authority and cutover

| Data | Before cutover | After cutover |
| --- | --- | --- |
| Staff identity, name, email, role, disabled state and eligibility | Hosted | Hosted publishes a read-only roster to edge; edge enforces the last applied roster and a bounded offline freshness policy. |
| Staff passwords, MFA enrollment, recovery codes and sessions | Each runtime separately | Each runtime separately. Enroll local credentials and manager MFA on the edge through a controlled, audited flow. Never export hosted secrets or sessions. |
| Categories, products, barcode mappings, prices, tax codes, active state and low-stock thresholds | Hosted | Hosted is the sole editor for the store; edge applies ordered versions and serves the local register. |
| Store stock and subsequent sale, return, purchase, adjustment and stocktake movements | Hosted before cutover | Edge is the sole writer. Hosted receives reporting events only and never imports them into operational stock. |

The current application has no branch scope. This plan is therefore limited to
one store. A manager chooses a cutover time, stops hosted checkout and hosted
stock writes for that store, and verifies there are no unresolved payments or
open shifts to migrate. After the first edge sale, hosted checkout for that
store must remain disabled. The current code does not enforce these restrictions;
the cutover control and edge/hosted write guards are prerequisites, not an
operator instruction that can substitute for code.

## Initial publication and application

1. A hosted manager with a verified MFA session starts publication for the
   configured store. The server captures a consistent, bounded snapshot of the
   staff roster (including disabled accounts and verification state),
   categories, products and barcodes, plus a proposed
   stock quantity for each product at the cutover time. Include archived
   products and their identifiers so historical references stay valid. Do not
   include password hashes, MFA secrets, recovery codes, session tokens,
   verification records, mail jobs or authentication audit rows.
2. Give the publication an immutable `storeId`, `generation`, `schemaVersion`,
   `configurationVersion`, creation/expiry time, row counts and content digest.
   The hosted server must authenticate the edge separately from staff browser
   sessions, authorize that exact store, use HTTPS and a short-lived,
   single-use provisioning grant, and audit issuance and consumption. Do not
   reuse the cash-event HMAC secret as the provisioning credential.
3. The edge downloads and validates the complete publication into staging.
   Check schema version, store identity, generation, expiry, digest, all
   referential constraints, unique normalized emails/SKUs/barcodes, money and
   quantity bounds, and maximum row/byte limits before changing operational
   tables. A failed or incomplete download leaves the prior state untouched.
4. Apply staff and catalogue rows in one edge transaction with the matching
   `configurationVersion` checkpoint. An initial apply requires an empty edge
   business database, the expected store ID and no sale, shift, stock movement
   or pending outbox event. An exact retry is a no-op; a different payload for
   the same version or a version rollback is rejected. Existing catalogue and
   staff history is not silently rewritten.
5. Enroll a rostered manager's local password and local MFA through a
   controlled, audited in-person identity check. Then enroll each other
   rostered person's local password and, where required, MFA. Local email
   verification or a separate, audited in-person identity check must be
   completed before creating an active edge session. The bootstrap manager
   path must be implemented explicitly; the existing hosted one-time manager
   command and ordinary `auth:provision` command do not provide this workflow.
   No public signup is added.
6. The proposed stock snapshot is a count worksheet, not an automatic stock
   adjustment. The manager verifies physical counts and signs off the opening
   quantities and cutover time. In one edge transaction, create the initial
   `inventory_stock` balances and append `opening` movements for positive
   quantities with stable operation IDs, local manager actor and a bootstrap
   reason. Missing/zero products start at zero. A replay cannot add opening
   stock twice. Record the hosted quantity and any counted variance in an
   audit/checkpoint record, without altering hosted stock. Do not enable
   checkout until this transaction and reconciliation complete.

The publication must not cross a cutover while hosted staff/catalogue writes
continue unnoticed. Its `configurationVersion` and data must come from the
same database snapshot. The local opening-stock approval is independent of
the catalogue checkpoint and remains immutable after first checkout.

## Configuration versions after bootstrap

Add a per-store, monotonically increasing `configurationVersion` and an
append-only hosted change journal for roster eligibility, categories, products
and barcodes. Each relevant write, including staff verification/suspension and
CSV import, must serialize on the store version row and append its change in
the same database transaction. A sequence allocated before commit is not a
safe cursor because concurrent transactions can commit out of order. Publish a
snapshot at version `V` and only changes committed after `V` in strict order.

The edge applies a contiguous batch transactionally, preserving hosted IDs
and revisions. Catalogue changes retain the hosted actor/reason in edge
history or an equivalent append-only source audit; a local sync service actor
alone must not erase who made the change. It advances its checkpoint only
with the corresponding row changes. A repeated batch is harmless; a gap,
unknown schema, conflicting
revision or changed digest stops application and raises a visible manager
error. The next download resumes from the durable checkpoint, including after
a crash. A complete fresh snapshot may repair an unapplied catalogue gap only
before local sales reference that catalogue state; otherwise use an explicit
repair procedure that preserves sale and inventory history. Never replace the
edge database or overwrite local balances as a routine resync.

When connectivity is lost, keep the last applied prices and roster visible
with their version and age. For the simulated pilot, allow checkout for at most
24 hours since the last successful authenticated roster check (including a
check that reports no changes); after that, block new
sessions and checkout until roster freshness is restored. This proposed limit
trades longer outage coverage for revocation delay and must be agreed before
live use. Detect a backward local clock or missing freshness checkpoint and
fail closed. A disabled/removed staff member is rejected immediately once the
change arrives, with local sessions revoked in the same edge transaction.
Managers cannot edit centrally owned staff or catalogue fields on edge. Edge
inventory writes remain local; hosted inventory writes for the cut-over store
remain blocked.

## Replacement shop PC

The `storeId` represents the physical store and stays stable. A replacement
PC receives a new `generation` and new credentials; only one generation may
send events or accept checkout. The existing event envelope and hosted inbox
do not yet enforce generations, so this is a required protocol change.

1. Freeze the old edge, stop checkout and workers, and preserve its encrypted
   database backup. Verify local sale, return, stock and outbox totals and the
   hosted accepted-event checkpoint. Deliver all pending events while the old
   PC is available. If it is lost, restore the latest edge backup and compare
   every restored event/sale identity with hosted receipts before proceeding.
   Hosted reporting projections cannot reconstruct the operational database.
2. Revoke the old generation and provisioning grant at hosting, rotate the
   per-store event secret, and record the audited handoff. Fence the old PC
   before allowing the new generation to send or accept checkout. Physically
   retire or wipe the old PC. Hosted fencing rejects its later deliveries,
   but cannot remotely stop a disconnected old PC from writing local sales.
3. Restore the verified edge backup onto the new PC, preserving the store ID,
   business IDs and outbox. Apply a compatible schema migration, configure
   the recovered local auth encryption secret (or explicitly re-enroll local
   MFA under a new secret), and the new generation credentials. Invalidate old
   sessions and reconcile local and hosted checkpoints. Reapply only
   contiguous hosted configuration versions newer than the restored checkpoint.
4. Activate checkout only after the manager signs off totals and the old
   generation is rejected by the hosted inbox. Duplicate delivery from a
   restored outbox must receive the existing idempotent acknowledgement.

If a backup is missing local sales or movements, stop the handoff and reconcile
from receipts and other evidence through an audited recovery process. Do not
bootstrap a blank edge under the same store ID and start selling while prior
local history is unresolved. A replacement during a complete internet outage
cannot safely prove fencing or hosted receipts, so activation waits for
connectivity or an independently verified recovery authority.

## Build and acceptance order

1. Completed in source: hosted operational cutover guards, edge staff/catalogue
   API guards and a durable single-store generation/configuration checkpoint.
   Focused HTTP and disposable-PostgreSQL tests cover denied writes, checkpoint
   replay and stale generation rejection. The cutover and fence methods are
   internal only; there is no operator endpoint or command yet.
2. Implement versioned snapshot publication, bounded authenticated transfer,
   validation, atomic edge apply and audited local credential enrollment.
   Exercise crash/retry, duplicate, out-of-order, corrupt and expired payloads
   against disposable PostgreSQL databases.
3. Implement the change journal and resume cursor. Test concurrent writer
   commit order, staff suspension/session revocation, catalogue changes and
   CSV import. Verify the 24-hour pilot freshness rule at the authorization
   boundary, including existing sessions.
4. Implement opening-count signoff and generation fencing. Test exact
   count/movement replay, restored outbox duplicate delivery, lost-PC
   reconciliation and rejection of the old PC.
5. Run a two-database rehearsal with identical store ID, dropped responses,
   restarts and a long outage. Record counts, money and stock totals before
   considering a live offline pilot.
