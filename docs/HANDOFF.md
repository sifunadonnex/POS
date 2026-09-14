# Pay & Go handoff

**Updated:** 14 September 2026

**Current phase:** Starter applications inspected; project rules established. No POS business workflow is implemented.

Read `../AGENTS.md`, the scoped rules and the architecture plan before working. Reinspect source and Git status: this file records the last observed state, not an automatic guarantee.

## Settled direction

- Use one root Git repository for frontend, backend and documentation. The user explicitly selected this arrangement.
- Strict shadcn/ui components using the existing Base UI `base-nova` setup, Tailwind theme tokens and Lucide icons. Business screens compose these components.
- React/Vite frontend, NestJS backend, PostgreSQL persistence planned.
- Reuse the existing HostPinnacle account for the online test. The user sees PostgreSQL and Node.js application management in the panel; deployment has not been tested.
- No additional Vercel subscription or phone VPN planned. Offline checkout is not part of the initial hosted test; live-operation continuity remains a decision.
- Use pnpm per application. Both current lockfiles are `pnpm-lock.yaml`; no root workspace or root package scripts exist.

## Current implementation

| Area | Observed state |
| --- | --- |
| Frontend | React 19 / Vite 8 / TypeScript 6 starter; Tailwind, shadcn and Base UI configured |
| UI | Starter `App.tsx`, generated shadcn Button, theme provider and light/dark tokens |
| Backend | NestJS 12 / TypeScript 6 starter, ESM/NodeNext, Hello World controller/service |
| Backend tooling | Oxlint, Vitest unit and HTTP test configurations, Nest build |
| Telemetry | Starter imports `@nestjs/observe`; no project decision to activate an external telemetry service |
| PostgreSQL | No driver/ORM/migration integration or connection proof implemented |
| Product features | No login, permissions, catalogue, checkout, stock ledger, shifts or real reports |
| External integrations | No implemented M-Pesa/eTIMS flow; no deployment performed |

Local tool versions observed: Node.js `v24.15.0`, pnpm `11.10.0`. These are observations, not a verified HostPinnacle runtime requirement. Dependency manifests and lockfiles are authoritative for package versions.

## Changes in this session

- Added root and scoped `AGENTS.md` files with shadcn, engineering, Git and verification rules.
- Added the root README and this reusable handoff.
- Added `.editorconfig` and `.gitattributes` for predictable text handling without rewriting existing source.
- Expanded the root `.gitignore` for environment secrets, generated output, test artifacts and the local history archive. Sanitized environment examples and SQL migrations remain eligible for tracking.
- Moved only `frontend/.git` and `backend/.git` into the ignored archive below, as explicitly authorized. Starter source was preserved.
- Linked the architecture to these rules and made strict shadcn usage explicit.

## Git state and preserved history

Both `git -C frontend rev-parse --show-toplevel` and the backend equivalent now resolve to the root project. Do not initialize new repositories inside these directories.

| Original repository | Local history archive | HEAD verified after move |
| --- | --- | --- |
| Frontend starter | `.local/git-history/frontend.git` | `43c34d4` — feat: initial commit |
| Backend starter/upstream | `.local/git-history/backend.git` | `015a5c5` — upstream merge commit |

These archives are ignored recovery material on this computer, not part of a clone or a hosted backup. Inspect history read-only using `git --git-dir=.local/git-history/frontend.git log` or the backend equivalent. Do not restore them inside the active starter directories during normal development.

At session entry, the root reported `?? frontend/` and `?? backend/`; the backend's nested repository also reported its original `package-lock.json` deleted and `pnpm-lock.yaml` untracked. The current pnpm setup was preserved rather than restoring npm's lockfile.

No commit or push was performed. The scaffolds and new documentation remain intentional uncommitted root changes. When a commit is authorized, review and stage explicit paths, confirm no archive/secrets/generated output are included, then commit a deliberate baseline. Do not mistake this pending baseline for disposable scratch files.

## Verification snapshot

Checks run against the existing starters during this documentation session:

| Directory | Command/check | Result |
| --- | --- | --- |
| `frontend/` | `pnpm run lint` | **Failed:** `react-refresh/only-export-components` for exported `buttonVariants` in generated `src/components/ui/button.tsx` |
| `frontend/` | `pnpm exec tsc -b` | Passed |
| `frontend/` | Production bundle / browser inspection | Not run; no UI changes made |
| `backend/` | `pnpm run lint` | Completed with one redundant-Boolean warning in `src/app.module.ts` |
| `backend/` | `pnpm run test` | **Failed:** Hello World unit test setup hook exceeded 10,000 ms; cause not diagnosed |
| `backend/` | `pnpm run build` | Passed |
| `backend/` | `pnpm run test:e2e` | Not run |
| Root | Nested Git archive HEADs and root resolution | Verified |
| Root | Ignore checks for archive, env secrets and generated output | Verified |

Vitest also reported that the `vite-tsconfig-paths` plugin could be replaced by native Vite support. Treat this as an advisory, not a proven cause of the timeout. Do not increase timeouts or weaken checks without investigating.

The frontend's current `typecheck` script is `tsc --noEmit` against an empty root file list with project references; use `tsc -b` or the production build to cover the actual application/configuration projects.

No application processes were intentionally left running by this session. Documentation checks passed: relative links, required files, whitespace and ignore behavior. Environment example files and SQL migrations were verified to remain trackable. These checks do not constitute a green application baseline.

## Next work, in order

1. Establish a green starter baseline: diagnose the backend unit-test timeout and apply a narrow, documented solution for the generated shadcn Fast Refresh lint conflict. Check the backend lint warning. Preserve the chosen shadcn preset.
2. Correct the frontend typecheck script to cover project references, then run lint/build and relevant tests with explicit per-command outcomes. Review starter telemetry/deployment hooks before any hosted runtime use; do not activate paid/external services by default.
3. Prove HostPinnacle deployment using an isolated test application and database: supported Node.js version, startup method, HTTPS, PostgreSQL create/connect/migrate, logs/restart, backup/restore and phone access. Select the owned test domain when deployment access is available.
4. Implement the first complete feature path: product catalogue and import, then cash checkout with atomic stock updates, receipt/reprint and phone sales reporting. Design authentication/permissions and migrations as part of the foundation, not as implied existing functionality.

No account credentials or domain were supplied. Hosting versions, capacity, backup capabilities, ORM/migration choice and actual live M-Pesa/eTIMS arrangement remain unresolved. They do not prevent local baseline work.

## How to maintain this handoff

At the end of meaningful work, replace stale sections above and record:

- What is actually implemented, including relevant file paths.
- Decisions made and whether they were user-directed or proposed.
- Exact verification commands and passed/failed/not-run status; distinguish existing failures.
- Any data migration, environment/configuration changes, and operational implications.
- Current intentional Git changes, commit ID if created, and services left running.
- Remaining blockers and the next executable task.

Keep enduring architecture choices in the architecture decision log and recurring working rules in `AGENTS.md`. Do not turn this file into a chat transcript or store secrets, real customer data, or unsupported “all tests pass” claims.
