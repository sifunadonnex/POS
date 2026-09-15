# Pay & Go project rules

These rules apply throughout this repository. Read the more specific frontend or backend rules before changing that project. Explicit user instructions take precedence; record any lasting change to an agreed project decision.

## Start every session

1. Read this file and `docs/HANDOFF.md`.
2. Read `docs/POS_ARCHITECTURE_AND_PLAN.md` for the current architecture and relevant business rules.
3. Read `frontend/AGENTS.md` or `backend/AGENTS.md` for the area being changed.
4. Inspect `git status --short`, the relevant diff, package scripts and actual source. Treat the handoff as a snapshot, not proof that files or tests still have the same state.
5. Identify the requested outcome and implement the smallest complete change. Do not introduce unrelated rewrites or speculative infrastructure.

## Current project decisions

- One root Git repository containing `frontend/`, `backend/` and `docs/`.
- Frontend: React, TypeScript, Vite, Tailwind and **shadcn/ui exclusively for UI components**, using the existing Base UI configuration.
- Backend: NestJS, TypeScript and PostgreSQL via `pg`, with explicit SQL migrations managed by `node-pg-migrate`. See `docs/BACKEND_SETUP.md`; local PostgreSQL 18.6 migration/API verification passed, but hosting verification is still pending.
- Authentication: Better Auth 1.7.4 provides local email/password login and database sessions, with server-side manager/cashier roles. Read `docs/LOCAL_AUTH_SETUP.md`. Use the relevant installed Better Auth skills and version-matched official documentation before changing authentication. Public registration is blocked; recovery, verification and manager MFA remain pre-live follow-ups.
- Hosting target: existing HostPinnacle account, with Node.js and PostgreSQL listed by the user. Deployment compatibility is still unverified.
- User-directed priority (15 September 2026): continue local development; defer deployment troubleshooting. Hosted verification gates the hosted pilot/live use, not local feature development. Preserve deployment work without running it.
- Initial hosted test requires internet. Do not claim offline checkout, production readiness, payment confirmation or fiscal compliance without implementing and verifying it.
- Use pnpm separately within each project; both use `pnpm-lock.yaml`. There is no root JavaScript workspace yet.
- No new paid services, competing UI kits, deployment platforms or architecture migrations without a user-directed decision.
- Do not run deployment scripts, publish packages, enable external telemetry, charge payments or transmit real invoices as part of ordinary local verification.

## Git and worktree hygiene

- Inspect existing changes before editing. User changes remain theirs; preserve them, including intended deletions and lockfile changes.
- Do not create nested Git repositories. The original starter histories are preserved locally under ignored `.local/git-history/`; never stage this archive.
- Keep dependencies, generated builds, coverage, logs, secrets, database exports and scratch files out of commits. SQL migration source must remain trackable.
- Commit sanitized `.env.example` templates only. Never copy secrets into documentation, screenshots, terminal output or handoffs.
- Stage explicit paths when committing; review `git diff --cached` and `git diff --cached --check`. Avoid broad staging that sweeps in unrelated work.
- Make focused commits with accurate messages when the user requests commits or explicitly authorizes an ongoing commit workflow. Do not push, amend or rewrite history without authorization.
- A clean worktree means deliberate, accounted-for changes and no accidental artifacts. Uncommitted task work is acceptable when commits have not been authorized; report it accurately. Never delete, reset, hide, stash or auto-commit user work merely to make status empty.
- At handoff, run `git diff --check` and inspect `git status --short`, including untracked files. Record remaining intentional changes and any unresolved failures.
- Follow `.editorconfig`, `.gitattributes` and each project's formatter. Do not mass-format or renormalize unrelated starter files.

## Engineering standards

- For authentication work, read `better-auth-best-practices` and the applicable setup, security, email/password, MFA or organization skill before changing that area. Verify examples against version-matched official documentation and installed types/source; do not copy skill snippets blindly or run unpinned `@latest` commands. Use pnpm and preserve the project's migration and shadcn conventions. Installing a skill does not authorize enabling every plugin or adding multi-tenancy.

- Keep strict TypeScript enabled. Prefer narrow types and explicit contracts; validate unknown external input at runtime. Do not introduce `any`, `@ts-ignore`, broad assertions or disabled checks to conceal defects.
- Keep code organized by business feature; avoid giant controllers, pages and generic utility dumping grounds. Build abstractions after a real shared need appears.
- Reuse existing dependencies and conventions. Review a new dependency's purpose, licence, maintenance and hosting compatibility before adding it; update the matching lockfile with pnpm.
- Keep authentication, authorization, calculations and database writes server-authoritative. Hiding a button is not access control.
- No fake success messages, silently swallowed errors, unfinished buttons presented as working, or placeholder data presented as live data.
- Keep credentials and business records out of browser bundles. Every `VITE_*` variable is public build-time configuration, not a secret store.
- Include loading, empty, error, disconnected and retry behavior where applicable. Guard against repeated submission.
- Preserve exact currency arithmetic, immutable completed sales, append-only stock movements, audit records and idempotency. The architecture document defines the detailed invariants.

## Verification and completion

- Run relevant existing checks for changed code, using the commands in the scoped rules. Documentation-only changes require review, valid paths and whitespace checks, not invented code tests.
- Add meaningful tests for business behavior, authorization, failure handling and regressions. Do not add tests that merely mirror an implementation or snapshot incidental markup.
- Never weaken a test, lint rule or compiler setting just to obtain a pass. Distinguish a pre-existing failure from one introduced by the task.
- Report the command, result and scope of verification. A successful build does not establish a working database, deployed API or production system.
- Keep frontend type checking in TypeScript build mode so it traverses both referenced projects. Use `pnpm run typecheck` or the production build documented in `frontend/AGENTS.md`.
- Update `docs/HANDOFF.md` when code, configuration, decisions or verification status materially changes. Update the architecture document when the architecture changes.
- Stop task-started services when no longer needed, or document the service and port if it is intentionally left for the user.
- Finish with the result, important verification and any unresolved issue. Leave a concrete next step in the handoff rather than an ambiguous “continue development.”

## Durable memory

- `AGENTS.md` files: working rules and non-negotiable conventions.
- `docs/POS_ARCHITECTURE_AND_PLAN.md`: product scope, architecture, tradeoffs and decision log.
- `docs/HANDOFF.md`: current implementation, evidence, unfinished work and next steps.
- Git history: committed changes. Local Git archives are recovery material, not the project's active history.

Keep these documents concise and consistent. Replace stale handoff status rather than growing an unbounded chat transcript. Mark proposals, user-confirmed facts, inspected code and verified behavior distinctly. Never record a feature as complete because it appears in the plan.
