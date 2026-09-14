# Pay & Go

Supermarket POS with a cashier web interface and a manager dashboard for phones. The repository currently contains starter applications; business features and PostgreSQL integration are not implemented yet.

## Start here

- [Project rules](AGENTS.md)
- [Current handoff and next steps](docs/HANDOFF.md)
- [Architecture and delivery plan](docs/POS_ARCHITECTURE_AND_PLAN.md)
- [Frontend rules](frontend/AGENTS.md)
- [Backend rules](backend/AGENTS.md)

## Repository

| Directory | Purpose |
| --- | --- |
| `frontend/` | React, Vite, TypeScript, Tailwind and shadcn/ui (Base UI preset) |
| `backend/` | NestJS and TypeScript; PostgreSQL is planned |
| `docs/` | Architecture, decisions and session handoff |

Use pnpm independently in each application directory. There is one root Git repository and no root pnpm workspace. See the scoped rules for installation, development and verification commands.

The intended hosted test uses the existing HostPinnacle account for the frontend, API and PostgreSQL. Runtime compatibility is unverified. Initial checkout requires internet; local development does not imply offline production support.

Before ending a work session, update the handoff with what actually changed, verification results, unresolved issues and the next concrete task. Never put credentials or real customer records in these documents.
