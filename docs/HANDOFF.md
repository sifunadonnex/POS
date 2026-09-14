# Pay & Go handoff

**Updated:** 14 September 2026

**Current phase:** Starter baseline verified locally. No POS business workflow or PostgreSQL integration is implemented.

Read `../AGENTS.md`, the scoped rules and the architecture plan before working. Reinspect source and Git status: this file records the last observed state, not a permanent guarantee.

## Settled direction

- One root Git repository containing frontend, backend and documentation.
- Strict shadcn/ui using the existing Base UI `base-nova` setup, Tailwind theme tokens and Lucide icons.
- React/Vite frontend, NestJS backend and PostgreSQL persistence planned.
- Reuse HostPinnacle for the online test. The user sees PostgreSQL and Node.js application management in the panel; actual runtime compatibility and deployment remain unverified.
- No extra Vercel subscription or phone VPN planned. Initial hosted checkout requires internet.
- Use pnpm separately in each application, with a `pnpm-lock.yaml` in each. No root JavaScript workspace exists.

## Current implementation

| Area | Observed state |
| --- | --- |
| Frontend | React 19 / Vite 8 / TypeScript 6 starter; Tailwind, shadcn and Base UI configured |
| UI | Starter screen, shadcn Button and theme provider; Button styles now exported separately for Fast Refresh |
| Frontend checks | ESLint enabled; `typecheck` traverses project references with `tsc -b`; production build works |
| Backend | NestJS 12 / TypeScript 6 starter, ESM/NodeNext, Hello World controller/service |
| Backend checks | Oxlint, Vitest unit/HTTP tests and Nest build; all passed in this session |
| Runtime | Normal Nest logging; external Observe instrumentation and generic deployment helper removed |
| PostgreSQL | No driver/ORM, migrations or connection proof yet |
| Product features | No login, permissions, catalogue, checkout, stock ledger, shifts or live reports |
| Integrations/hosting | No M-Pesa/eTIMS implementation or hosted deployment |

Local tools observed: Node.js `v24.15.0`, pnpm `11.10.0`. These are not confirmed HostPinnacle requirements. Manifests and lockfiles define dependency versions.

## Latest changes

- Split the generated Button's styling function into `frontend/src/components/ui/button-variants.ts`. The component file exports only `Button`; no Fast Refresh rule was disabled and the shadcn styles were preserved.
- Corrected `frontend/package.json` so `typecheck` runs `tsc -b`.
- Changed the frontend Vite alias to use `fileURLToPath(new URL(..., import.meta.url))`, resolving the warning about `__dirname` and future native configuration loading.
- Removed Observe imports/instrumentation from backend bootstrap and AppModule. Removing that unused starter feature also eliminated its redundant-Boolean lint warning.
- Removed `@nestjs/observe`, `@nestjs/mau` and the generic `deploy` script. The production entrypoint now explicitly uses `node dist/main.js`.
- Replaced `vite-tsconfig-paths` with `resolve.tsconfigPaths: true` in both backend Vitest configurations and removed the old plugin. This removed its deprecated `tsconfck` dependency and TypeScript peer mismatch. See [Vite's native path-resolution option](https://vite.dev/config/shared-options#resolve-tsconfigpaths).
- Regenerated the backend pnpm lockfile and verified no backend peer issues remain. No new package was added.
- Ignored pnpm's local package-store cache so dependency operations do not leave generated files in Git status.
- Updated scoped rules and this handoff. Formatting changes were limited to touched source/config files.

## Verification snapshot

Final code checks run locally in the respective application directories:

| Directory | Command/check | Result |
| --- | --- | --- |
| `frontend/` | `pnpm run lint` | Passed |
| `frontend/` | `pnpm run typecheck` | Passed; command uses TypeScript build mode |
| `frontend/` | `pnpm run build` | Passed, including TypeScript check and production bundle |
| `backend/` | `pnpm run lint` | Passed without the previous lint warning |
| `backend/` | `pnpm run build` | Passed |
| `backend/` | `pnpm run test` | Passed: 1 unit test |
| `backend/` | `pnpm run test:e2e` | Passed: 1 HTTP test |
| `backend/` | `pnpm peers check` | No peer dependency issues |
| Local runtime | Started compiled `dist/main.js` on an available port and requested `/` | HTTP 200, expected Hello World body; child process stopped |
| Changed source/config | Prettier checks | Passed after formatting |
| Root | Diff/whitespace review | Passed |

The earlier 10-second unit-test setup timeout did not reproduce: the unchanged unit test passed before backend code changes and passed again after cleanup. Its original cause remains unproven; timing/load may have contributed, but that is an inference. No timeout was raised and no test was removed or bypassed. Investigate if it recurs.

These are starter tests only. They do not verify sales, authentication, database transactions, deployed hosting, hardware or fiscal integrations. No frontend test runner is configured. No browser visual check was needed for this non-visual component/configuration refactor; do not claim a browser UX review.

Dependency installation needed registry access after offline installation could not find a cached package. Installation completed with the updated lockfile. Normal pnpm lint/build/test commands subsequently ran successfully.

No development servers or smoke-test child processes were left running. The temporary smoke-test script was removed; generated build output is ignored.

## Git state and history

The user committed the initial scaffold and rules as `3186aaa` (`initial scafold`). The worktree was clean at the start of this implementation session.

This session made source/configuration, dependency-lockfile and documentation changes. They remain uncommitted; no commit, push or history rewrite was performed. The new `button-variants.ts` must be included with the Button change when committing. Review explicit paths and stage only intended changes.

The earlier user-authorized Git consolidation is complete. Both application directories belong to the root repository. Original histories remain in ignored local archives:

| Original repository | Local archive | Preserved HEAD |
| --- | --- | --- |
| Frontend | `.local/git-history/frontend.git` | `43c34d4` |
| Backend/upstream | `.local/git-history/backend.git` | `015a5c5` |

These local archives are not included in a clone or remote backup. Use `git --git-dir=.local/git-history/frontend.git log` (or backend equivalent) for read-only history inspection. Never restore nested repositories during normal development.

## Next work, in order

1. Prepare the local deployment proof: a minimal health endpoint, documented/validated environment configuration, and one chosen PostgreSQL driver/migration approach with an isolated test database. Preserve ESM imports and keep credentials out of client builds.
2. Once secure hosting access and a test domain are available, verify HostPinnacle's Node.js/PostgreSQL versions, startup mechanism, HTTPS, database migration/rollback, process restart, logs, limits, backup/restore and phone access. This is the architecture plan's first hosted gate.
3. Build the application foundation (authentication, permissions and catalogue), then the first complete cash-sale path with atomic inventory updates, receipt/reprint and manager reporting.
4. Add meaningful frontend and PostgreSQL integration tests as those features appear. Existing Hello World checks are not sufficient coverage for POS operations.

## Open items

- HostPinnacle package/version/capacity, owned test domain and secure deployment access have not been supplied.
- ORM/migration selection, local test PostgreSQL availability and backup arrangements remain unresolved.
- Initial testing versus real customer sales, actual M-Pesa/eTIMS process, weighted goods and offline continuity requirements still need confirmation.
- The starter theme provider's global `d` shortcut needs review before implementing cashier/scanner input.
- No deployment command or external telemetry platform is selected. Do not reintroduce removed starter services by default.

## Maintaining this handoff

After meaningful work, replace stale status and record implemented files, decisions, exact checks and outcomes, migration/configuration impact, Git state, services left running and the next executable task.

Keep durable architecture decisions in the architecture document and recurring rules in `AGENTS.md`. Do not record secrets, real customer data, chat transcripts or unsupported completion claims.
