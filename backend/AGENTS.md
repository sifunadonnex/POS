# Backend rules

Read `../AGENTS.md` first. These rules apply to all backend files.

## Application structure

- Keep NestJS modules organized around business areas: identity, catalogue, sales, inventory, shifts and integrations as they are implemented.
- Controllers handle transport concerns; services implement use cases. Keep database access explicit and transaction boundaries within the business operation.
- Preserve the starter's ESM/NodeNext configuration and `.js` suffixes for local runtime imports. Match its formatter (single quotes and semicolons).
- Validate request bodies, parameters, environment configuration and provider messages. Never rely only on TypeScript types at API boundaries.
- Authorize protected actions on the server, including branch/till scope and supervisor approvals. Never accept trusted totals, roles or payment confirmation directly from the browser.
- Return useful, structured errors without database details, stack traces, credentials or provider secrets in user responses.

## PostgreSQL and transaction safety

- Use `pg` and versioned SQL through `node-pg-migrate`; see `../docs/BACKEND_SETUP.md`. Do not mix ORMs or add production schema auto-sync. Migrations run explicitly, never on application startup.
- Use versioned migrations, parameterized queries, bounded connection pools and a dedicated application user. Keep development, test and live databases separate.
- Never run destructive migrations or tests against real shop records. Describe data impact and recovery for schema changes.
- Finalize sale, cash tender, stock movements and audit writes atomically. Unique request IDs and constraints must protect against retries and concurrency.
- Use exact money/quantity arithmetic, snapshot historical prices/taxes/costs, and preserve completed sales. Corrections are linked records.
- External payments need their own durable attempt/state/reconciliation process. A request timeout is not proof of failure and must not automatically trigger a second charge.
- Keep logs useful but redact personal/payment data. Audit records must identify the actor and reason for sensitive actions.

## Runtime and integrations

- Read port and credentials from server configuration. Do not assume HostPinnacle permits root access, persistent background workers, Docker, unlimited memory or every Node.js version.
- Persist retry jobs and use a verified scheduling mechanism. Important work must survive application recycling.
- External starter telemetry (`@nestjs/observe`) and the generic Nest deployment helper (`@nestjs/mau`) have been removed. Keep normal Nest logging; add external telemetry or a deployment service only after an explicit project decision. Standalone production entrypoint is `dist/main.js`; Passenger startup is `app.cjs`, which imports the ESM build. Hosted Passenger behavior remains unverified.
- Build upload archives locally with `pnpm run hosting:package` on Windows; see `../docs/HOSTPINNACLE_DEPLOYMENT.md`. Never upload local environment files or node_modules. Keep runtime imports such as tslib in dependencies, not devDependencies. Hosting install uses pinned pnpm and its frozen lockfile, even when the panel invokes the script using npm.
- `hosting:migrate` runs the compiled migration without building or installing dependencies. Keep migration execution out of install/startup hooks and public HTTP endpoints. Local package building is not permission to deploy or run commands against hosted databases.
- Keep M-Pesa/eTIMS adapters simulated until actual workflows are authorized and implemented. No real external calls from tests; mock adapters and use isolated test credentials where appropriate.

## Checks

Run from `backend/` (use `pnpm.cmd` on Windows where needed):

| Purpose | Command |
| --- | --- |
| Install exact dependencies when needed | `pnpm install --frozen-lockfile` |
| Development | `pnpm run start:dev` |
| Lint | `pnpm run lint` |
| Unit tests | `pnpm run test` |
| HTTP/end-to-end tests | `pnpm run test:e2e` |
| Type-check source and tests | `pnpm exec tsc --noEmit --incremental false` |
| Isolated PostgreSQL migration test | `pnpm run test:integration` (requires explicit `TEST_DATABASE_URL`; never real shop data) |
| Production build | `pnpm run build` |
| Build backend upload ZIP locally (Windows) | `pnpm run hosting:package` |
| Check formatting of changed files | `pnpm exec prettier --check <changed-files>` |

Use unit tests for calculations/services, HTTP tests for validation/auth/error contracts, and real isolated PostgreSQL integration tests for transaction/concurrency behavior when persistence is introduced. Close application/database handles after tests. Do not simply increase timeouts or disable telemetry/testing rules to conceal unresolved startup behavior.

The current lint configuration relaxes `no-explicit-any`; this is not permission to add untyped business code. Record existing warnings accurately, and strengthen enforcement through a scoped change rather than silently claiming strict lint guarantees.
