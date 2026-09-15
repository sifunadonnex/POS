# Local staff authentication

## Scope

Implemented: email/password sign-in, database-backed sessions, logout, server-side manager/cashier role checks, a responsive shadcn sign-in screen, and a local-only staff provisioning command. No public registration, social login or paid identity service.

Email verification, password recovery, manager MFA, staff administration screens, account suspension, full authentication audit events and till/branch permissions are follow-up work before live use. No checkout or report screen is implemented. Deployment remains deferred.

## Run locally

From `backend/`, using the existing local PostgreSQL development configuration:

```powershell
pnpm run auth:setup
pnpm run db:migrate
```

`auth:setup` appends a random secret and `http://localhost:5173` origin to the ignored `.env` only if those keys are absent. It preserves existing values, prints no secrets, and refuses a non-loopback or non-`_dev` database configuration. If an existing auth value is invalid, correct it deliberately; the helper does not replace it.

Create `backend/.local/staff.env` privately in your editor:

```dotenv
STAFF_NAME=Shop Manager
STAFF_EMAIL=manager@example.test
STAFF_PASSWORD=choose_a_unique_password_of_12_to_128_characters
STAFF_ROLE=manager
STAFF_PROVISIONED_BY=local-developer
```

Replace the example with your own local test account details. Never commit or paste this file into chat. Then, from `backend/`:

```powershell
pnpm run auth:provision
pnpm run start:dev
```

The provisioning command refuses production and remote databases. It hashes the password with Better Auth, creates the user/account/audit row atomically, and rejects duplicate email addresses without changing an existing account. Repeat with a different email and `STAFF_ROLE=cashier` for a cashier. Remove the private staff file after provisioning; it contains the plaintext password. Do not put credentials in command-line arguments.

From a second terminal in `frontend/`:

```powershell
pnpm run dev
```

Open `http://localhost:5173` (not `127.0.0.1:5173`). Vite forwards `/api` to `http://127.0.0.1:3000`. The browser origin must exactly match `BETTER_AUTH_URL`; wildcard CORS is not enabled. These are local development servers, not a hosting deployment.

No development staff account is created automatically. Integration-test accounts exist only in disposable test schemas and are removed afterwards.

## Security and implementation notes

- Better Auth is pinned to 1.7.4 in both projects; the existing Nest wrapper resolves to 2.8.0. The official version index maps 1.7.x to the current 1.7 documentation. Installed types, schema metadata and behavior tests were also inspected.
- Auth state and roles are read from PostgreSQL; no cookie cache or browser-stored tokens. The frontend receives only the profile fields it needs from `/api/identity/me`.
- Nest's built-in body parser is disabled; the wrapper parses non-auth requests and gives raw auth requests to Better Auth.
- An application-wide guard protects Nest routes by default. Explicit public routes are the starter root and health probes. `/api/identity/manager-access` demonstrates manager-only access; it is not a report endpoint.
- Auth HTTP writes require an exact trusted Origin, including first login. Only login, logout, session lookup and auth health routes are enabled. Signup and profile/role mutation endpoints are blocked.
- Session cookies are HttpOnly/SameSite=Lax and Secure on HTTPS. The UI requests nonpersistent browser cookies. Session creation is explicitly bounded to eight hours because 1.7.4 otherwise assigns non-remembered sessions a 24-hour database lifetime. This is not an inactivity screen lock; sessions can refresh while active.
- Database rate limiting: at most five sign-in attempts per minute per observed socket IP. Browser IP headers are overwritten. Behind local Vite, users share the proxy socket limit. Hosted proxy/IP attribution must be designed and tested before deployment; do not blindly trust forwarded headers.
- Authentication errors are logged generically; no raw database errors, secrets or tokens are logged. The provisioning audit records only successful account creation and a supplied operator label; it is not yet a complete authenticated admin audit system.
- New tables are created by `202609150001_identity.sql`, not application startup. Its down migration deletes auth data and is only for deliberate isolated local/test rollback. Existing app metadata is preserved.

## Checks

Backend: `pnpm run test`, `pnpm run test:e2e`, `pnpm exec tsc --noEmit --incremental false`, `pnpm run lint`, `pnpm run build`.

Real PostgreSQL checks from `backend/`:

```powershell
node --env-file=.env.test node_modules/vitest/vitest.mjs run --config vitest.config.integration.ts
```

Tests require explicit `TEST_DATABASE_URL` ending in `_test`; they never fall back to the development URL. They create uniquely named schemas and drop only those schemas. Migration suites run serially because they share the database migration advisory lock.

Frontend: `pnpm run test`, `pnpm run lint`, `pnpm run build`. UI tests use Vitest, Testing Library and jsdom; they do not prove hosted cookies or real mobile connectivity. Run heavy suites separately on resource-constrained computers.

References: [Nest integration](https://better-auth.com/docs/integrations/nestjs), [database/schema](https://better-auth.com/docs/concepts/database), [rate limits](https://better-auth.com/docs/concepts/rate-limit), [email/password](https://better-auth.com/docs/authentication/email-password).
