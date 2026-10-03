# Offline edge register

The offline design uses a local Pay & Go API and PostgreSQL database on the
shop PC. The browser always talks to that local service, so losing the store's
internet connection does not move an in-progress checkout between unrelated
databases.

## What works in this slice

- `PAYGO_RUNTIME_MODE=edge` binds the local service to `127.0.0.1` and gives
  the simulated local register its own checkout authority. Once a bootstrap
  checkpoint exists, operational writes stay fenced until an audited signed
  cutover ticket is applied. Ticket issuance/application is disabled by default.
- Cash checkout still commits the sale, payment, stock reduction and cash
  movements atomically. The same transaction now appends a versioned
  `cash_sale.completed` event to `sync_outbox`. New events use schema version 2
  with immutable cashier and product display snapshots; the hosted parser can
  still ingest already-queued version-1 events using explicit legacy labels.
- The workspace identifies a local register and displays the pending outbox
  count. Browser internet-loss events recheck the local API instead of
  automatically ejecting the cashier.
- Edge mode requires a stable store UUID and refuses Daraja configuration.
  Card and M-Pesa therefore remain unavailable in this cash-only phase.
- Production HTTP is accepted only for a loopback edge origin. Hosted
  production continues to require HTTPS.
- When explicitly enabled, a durable worker claims queued events in bounded
  batches, signs them with a per-store HMAC and delivers them to the hosted
  HTTPS inbox. Failures retain the event with exponential retry; only a
  matching accepted/duplicate acknowledgement marks it delivered.
- The hosted inbox verifies the store, timestamp, signature and cash-sale
  invariants, then commits each event idempotently by event and sale identity.
  In the same transaction it creates append-only cash-sale and line reporting
  projections without writing hosted operational sales, payments or stock. Its
  acknowledgement includes an accepted-event checkpoint.
- The authenticated status API exposes edge queued/delivered totals and hosted
  received/projected counts. A manager-only reconciliation read compares exact
  edge queue totals or hosted inbox/projection totals; the workspace raises a
  visible warning when a received hosted event is missing its projection.

## Not implemented yet

Projected edge cash sales are intentionally separate from hosted operational
`sale`, payment and stock tables, so hosting never becomes a second writer for
the same checkout. Manager Sales insights can read hosted operations, the
configured synchronized store or both, and identifies each cashier/product
source plus any inbox-to-projection lag. Synchronized returns are explicitly
marked unavailable and are not subtracted from edge net sales yet. Staff,
returns, purchases, stocktake and other operational events do not replicate.
An initial signed snapshot/apply path, opening-count signoff and ordered
staff/catalogue change batches are in source. Change batches currently require
manual private-file transfer. Signed cutover and generation-aware delivery
are implemented behind a disabled-by-default gate; other staff credential
enrollment, lost-PC reconciliation, broader event coverage,
backup/restore and power-loss checks are
still required before live use.

The [hosted-to-edge bootstrap design](OFFLINE_BOOTSTRAP_DESIGN.md) defines the
store cutover, version checkpoints, local staff enrollment, opening stock
signoff and replacement-PC fencing required before those checks. The first
snapshot is now a private signed file, not a network download. No active store
has been cut over.

## Initial bootstrap rehearsal on disposable databases

Apply migrations through `202610030004_store_cutover_fence` to both
disposable hosted and edge databases. Configure `PAYGO_SYNC_ENABLED=true`, the
same store UUID and `PAYGO_SYNC_SECRET` on both sides, and a **separate**
`PAYGO_BOOTSTRAP_SECRET` of 32–500 random characters on both sides. The hosted
runtime uses `PAYGO_SYNC_STORE_ID`; the edge uses `PAYGO_STORE_ID`. Keep the
edge sender stopped/disabled during this rehearsal. These values are server
configuration only, never `VITE_*` variables.

1. A hosted manager with completed MFA calls `POST /api/bootstrap/publications`
   from their authenticated same-origin session. Save the JSON response in a
   private file and transfer it to the shop PC within 15 minutes. Treat the
   file as sensitive roster and price data. The response contains no hosted
   password hash, MFA secret, recovery code or session token.
2. On the edge, run `node dist/store/apply-bootstrap.js .local/bootstrap.json`.
   The command verifies the signature, store/generation, expiry, digest,
   references and size limits before applying roster/catalogue/checkpoint rows
   in one transaction. An exact immediate retry is harmless. A dirty database
   or different publication is refused. Remove the private bundle after the
   reconciliation evidence is retained securely.
3. In person, verify the publishing manager's identity and control of their
   email address. Put `BOOTSTRAP_MANAGER_EMAIL`, `BOOTSTRAP_MANAGER_PASSWORD`,
   `BOOTSTRAP_ATTEST_IDENTITY=true`, `BOOTSTRAP_ATTEST_EMAIL_CONTROL=true` and
   `BOOTSTRAP_WITNESSED_BY` in a private `.local/bootstrap-manager.env` file.
   Run `node --env-file=.local/bootstrap-manager.env
   dist/store/enroll-bootstrap-manager.js` from `backend/`, then remove the
   private input file. The command works only once for the publishing manager
   and audits the witness. The manager signs in to the local app and completes
   the existing authenticator MFA enrollment/challenge flow.
4. After physically counting **every** product, the MFA-proven local manager
   calls `POST /api/bootstrap/opening-stock` from the same-origin session with
   `{ "requestId": "<new UUID>", "counts": [{ "productId": "<UUID>",
   "quantityMinor": "<nonnegative integer>" }] }`. Use whole units for
   `each`/`pack` and thousandths for `kg`/`l`. Include zero counts. The edge
   creates stock balances and positive opening movements atomically, records
   variances from hosted proposed quantities and accepts only an exact replay.

This rehearsal does **not** activate checkout. A bootstrapped edge rejects
operational writes until a later hosted cutover and generation-aware
activation are explicitly enabled for a disposable rehearsal. The earlier simulated edge path with
no bootstrap checkpoint remains suitable only for disposable local tests.

## Ongoing configuration rehearsal

After the first snapshot is applied, hosted staff and catalogue writes append
ordered changes, including verification, suspension, archive and CSV import.
The hosted manager must have a current MFA session to request a batch. On the
edge, an MFA-proven manager reads `GET /api/bootstrap/checkpoint`. If the local
roster has expired and edge login is blocked, an operator with local shell
access runs `pnpm run edge:configuration-checkpoint` instead. Provide the
returned `version` and `digest` to hosted `POST /api/bootstrap/changes` as
`{"afterVersion": 1, "afterDigest": "<digest>"}`. Save the signed response
as a private JSON file and transfer it to the shop PC within 15 minutes. Run
`node dist/store/apply-configuration.js .local/changes.json` on the edge.
Repeat from the new edge checkpoint until the hosted response has an empty
`events` array. That empty signed batch refreshes the roster check time.
Keep the batch private because it contains staff identity and catalogue data;
remove transferred copies after securely retaining reconciliation evidence.

The edge applies each complete batch atomically. A changed digest, version
gap, incompatible revision, wrong store/generation or replay with different
content stops application. Hosted catalogue changes retain their actor and
reason in the edge source audit. A suspended staff member's local sessions are
removed when their change arrives. After a snapshot has been published,
publishing a different full snapshot is refused if journal changes exist;
resume from the journal cursor instead. The edge denies new sessions and
operational writes if the last authenticated roster check is missing, in the
future or at least 24 hours old. Existing sessions are denied at the next
authenticated request. This is a pilot limit and still needs an elapsed-time
and clock-change rehearsal before live use.

## Cutover and replacement rehearsal on disposable databases only

`PAYGO_CUTOVER_ENABLED=false` is the default on both runtimes. A controlled
rehearsal may set it to `true` on a disposable hosted/edge pair after migration.
The flag does not authorize cutting over an active store.
The migration adds a nullable synchronization-secret fingerprint and new audit
actions; it does not rewrite sales or stock. Rolling it back after cutover audit
rows exist requires a deliberate recovery plan and backup rather than an
automatic down migration.

1. Complete the edge opening count and apply configuration changes until the
   edge checkpoint equals hosting. Close hosted shifts and resolve pending or
   unknown payment attempts. An MFA-proven hosted manager calls
   `POST /api/bootstrap/cutover` with `requestId` (new UUID),
   `expectedGeneration`, `configurationVersion` and `configurationDigest` from
   the edge checkpoint. Hosting atomically blocks hosted operational writes,
   records the actor and returns a signed ticket valid for 15 minutes. If the
   response is lost, repeat the same request ID for a fresh ticket.
2. Transfer the ticket privately and run
   `node dist/store/apply-cutover.js .local/cutover.json` on the edge. The edge
   checks the signature, store, generation, current sync secret, exact
   configuration cursor, opening signoff, roster freshness and open work before
   enabling checkout. An exact retry is harmless. Keep the edge closed if
   transfer or validation fails.
3. For a replacement PC, first freeze/retire the old PC and reconcile its
   outbox and hosted receipts against the restored backup. Rotate
   `PAYGO_SYNC_SECRET` on hosting and the restored edge, then an MFA-proven
   hosted manager calls `POST /api/bootstrap/fence` with the same checkpoint
   fields and the old `expectedGeneration`. Hosting refuses the old secret,
   advances the generation and returns a signed fence ticket. Apply it on the
   restored edge with the same CLI; local sessions are revoked. The hosted
   inbox then rejects generation 1, while an identical queued event delivered
   under generation 2 receives a duplicate acknowledgement. A missing or
   behind backup requires an explicit recovery procedure, not a blank edge.

Generation is included in the signed delivery headers after cutover. A
disconnected old PC may still write to its own database, so it must be
physically retired. Lost-PC reconciliation, a full backup/restore and long
outage rehearsal have not been completed; leave the cutover flag off for active
stores.

## Safe local test configuration

Use a separate local database and a different authentication secret from the
hosted application. Generate and retain one UUID for the physical store; it is
an identity, not a rotating request ID.

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://pay_and_go:replace_me@127.0.0.1:5432/pay_and_go_edge
DATABASE_TLS=disable
DATABASE_POOL_MAX=5
PAYGO_RUNTIME_MODE=edge
PAYGO_STORE_ID=11111111-1111-4111-8111-111111111111
BETTER_AUTH_SECRET=replace_with_a_unique_random_secret_of_at_least_32_characters
BETTER_AUTH_URL=http://127.0.0.1:3000
AUTH_EMAIL_ENABLED=false
DARAJA_ENABLED=false
PAYGO_SYNC_ENABLED=false
PAYGO_SYNC_SECRET=replace_with_a_separate_random_secret_of_at_least_32_characters
PAYGO_BOOTSTRAP_SECRET=replace_with_another_private_random_secret_of_at_least_32_characters
PAYGO_CUTOVER_ENABLED=false
PAYGO_SYNC_URL=https://dev.sifulabs.co.ke/api/sync/events
PAYGO_SYNC_POLL_SECONDS=10
```

Keep synchronization disabled until migrations through
`202610020003_sync_reporting_projection` are applied to both databases. On the
hosted application, configure the same store UUID and synchronization secret,
but do not set a target URL:

```dotenv
PAYGO_RUNTIME_MODE=hosted
PAYGO_SYNC_ENABLED=false
PAYGO_SYNC_STORE_ID=11111111-1111-4111-8111-111111111111
PAYGO_SYNC_SECRET=replace_with_the_same_store_sync_secret
PAYGO_BOOTSTRAP_SECRET=replace_with_the_same_private_bootstrap_secret
PAYGO_CUTOVER_ENABLED=false
PAYGO_SYNC_POLL_SECONDS=10
```

The synchronization secret is not `BETTER_AUTH_SECRET` and must not be placed
in a `VITE_*` variable. After both sides are migrated and restarted, enable the
hosted inbox first and the edge sender second.

From `backend/`, build the combined frontend/API archive:

```powershell
pnpm run hosting:package
```

Extract the generated ZIP into a dedicated test directory on the shop PC. Put
the private `.env` there, install the pinned production dependencies, apply the
migrations explicitly and start the packaged application from that extracted
directory:

```powershell
pnpm run hosting:install
pnpm run hosting:migrate
node dist/main.js
```

The archive—not the repository's `backend/` directory—contains the built
frontend under `public/`. A source-development test can instead run Vite on
port 5173 and Nest on port 3000 with `BETTER_AUTH_URL=http://localhost:5173`.

Open `http://127.0.0.1:3000`, create test-only local staff/catalogue/stock,
open a shift and complete a cash sale. `GET /api/sync/status` should report
`mode: "edge"`, `checkoutAuthority: "local"` and an increased
`pendingEvents` count. Disconnect the internet—not the PC or PostgreSQL—and
repeat a cash checkout using the already loaded local page. Reconnect and
verify that the edge count moves from pending to delivered and that the hosted
status reports the same increase under `receivedEvents` and `projectedEvents`,
with `unprojectedEvents: 0`. As a signed-in manager, compare exact counts and
minor-unit totals at `GET /api/sync/reconciliation`. Test a dropped response
and a repeated delivery; neither may create a second inbox or projection row.

The foreground command is suitable for a controlled test only. A live edge
register still needs an approved Windows service/startup mechanism, a UPS and
a tested local backup/restore procedure.
