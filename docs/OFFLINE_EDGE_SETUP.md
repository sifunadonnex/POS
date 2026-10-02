# Offline edge register: first implementation slice

The offline design uses a local Pay & Go API and PostgreSQL database on the
shop PC. The browser always talks to that local service, so losing the store's
internet connection does not move an in-progress checkout between unrelated
databases.

## What works in this slice

- `PAYGO_RUNTIME_MODE=edge` makes the local service the checkout authority and
  binds it to `127.0.0.1` for the initial single-PC pilot.
- Cash checkout still commits the sale, payment, stock reduction and cash
  movements atomically. The same transaction now appends a versioned
  `cash_sale.completed` event to `sync_outbox`.
- The workspace identifies a local register and displays the pending outbox
  count. Browser internet-loss events recheck the local API instead of
  automatically ejecting the cashier.
- Edge mode requires a stable store UUID and refuses Daraja configuration.
  Card and M-Pesa therefore remain unavailable in this cash-only phase.
- Production HTTP is accepted only for a loopback edge origin. Hosted
  production continues to require HTTPS.

## Not implemented yet

There is no outbound worker or hosted ingestion endpoint in this slice.
`syncConfigured` therefore remains false and queued records stay local. Staff,
catalogue, stock setup, returns, purchases, stocktake and other configuration
also do not replicate yet. Do not use edge mode as the live system until the
sender, central idempotent ingestion, acknowledgements, reconciliation,
initial data/bootstrap procedure, backup/restore and power-loss checks pass.

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
```

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
repeat a cash checkout using the already loaded local page.

The foreground command is suitable for a controlled test only. A live edge
register still needs an approved Windows service/startup mechanism, a UPS and
a tested local backup/restore procedure.
