# HostPinnacle: isolated backend deployment proof

Target: `https://dev.sifulabs.co.ke/`. This package contains the backend health API, **not the React frontend or a working POS**. Hosting verification remains pending until the checks below pass. The user uploads files and runs panel commands; no SSH is required if the panel supports these commands with application environment variables.

## 1. Build the upload package locally

From `backend/` on Windows:

```powershell
pnpm run hosting:package
```

This builds locally and produces a timestamped `.local/releases/<id>/pay-and-go-backend.zip`. Its allowlist contains `app.cjs`, compiled `.js` files in `dist/`, SQL files in `migrations/`, package.json, pnpm-lock.yaml and this guide as DEPLOYMENT.md. It excludes local environment files, credentials, node_modules, npm lockfiles, source maps, tests, Git history and frontend files. Do not upload the repository or local node_modules instead. Do not add credentials to this archive.

## 2. Create the isolated application

Confirm the selected subdomain and directory do not serve an existing application before proceeding.

| Panel field | Value |
| --- | --- |
| Node.js version | `22.23.2` as shown in the user's panel |
| Application mode | Production (this is still an isolated test, not live trading) |
| Application root | `pay-and-go-dev`, a new directory outside `public_html` |
| Application URL | `dev.sifulabs.co.ke`, path `/` |
| Application startup file | `app.cjs` |
| Passenger log file | A private writable path under the account's logs directory; use the actual account path |

Extract the archive **inside the application root**: app.cjs, package.json and dist/ must be immediate children, not inside an extra backend/ directory. Replace only the newly generated placeholder startup file if the panel creates one. Do not overwrite unrelated files or the panel's node_modules link.

The wrapper dynamically imports the compiled ESM entrypoint. This follows the [CloudLinux Passenger ESM workaround](https://docs.cloudlinux.com/cloudlinuxos/cloudlinux_os_components/#limitations), but local wrapper success is not proof of the provider's Passenger behavior. Passenger owns process startup/restart; do not run a second long-lived `npm start` process in the command box.

## 3. Configure the hosted test database and environment

Use the hosting PostgreSQL tools to create a **new dedicated hosted test database/user**, assign the user to it, and obtain the actual hostname, port, PostgreSQL version and required TLS settings. Do not use the laptop's credentials or assume localhost points to the laptop. Review the initial SQL: it creates only app_metadata and an application marker; node-pg-migrate also maintains pgmigrations. The migration user needs table creation permission in this dedicated database's public schema.

Set these privately in the application's environment-variable controls:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` (normally set by Application mode) |
| `DATABASE_URL` | Hosted `postgresql://USER:PASSWORD@HOST:PORT/DATABASE`, percent-encoding credential characters; no URL query/fragment |
| `DATABASE_TLS` | `verify` for remote hosts; `disable` only if the provider confirms a loopback database host without TLS |
| `DATABASE_POOL_MAX` | `3` initially; check account connection limits and process count |

Do not override provider-supplied PORT. Our default is 3000 if it is absent; Passenger's listen behavior must be verified on hosting. If a provider supplies a non-numeric socket value, stop and report the format without secrets so the bootstrap can be adapted. A private certificate authority can be configured through NODE_EXTRA_CA_CERTS before process launch; never disable remote certificate verification.

No application startup or migration can succeed without valid environment settings. An initial startup error before configuration/dependency installation does not prove incompatibility.

## 4. Install and migrate using the panel command box

The user's screenshot confirms **Choose script** selects a package.json script. **Specify parameters** supplies arguments to that script; it is not an arbitrary shell-command box. Select the script name and leave parameters empty for the steps below. The script must execute with the selected application's root, Node 22.23.2 and environment settings.

For the current installation memory failure, upload the updated backend/package.json to the application root (preserve any intentional hosting-only edits), refresh the application page and select **hosting:diagnose**, leaving parameters empty. This short-lived script needs no installed dependencies. It prints Node version/platform/architecture, current process memory and the V8 heap limit, then exits. It does not read environment files, print credentials, connect to a database, install packages or listen on a port. It does not measure total account/LVE memory or prove installation will succeed.

If it fails with the same allocation error, ask HostPinnacle to inspect basic Node startup/process limits. If it succeeds, share its output and the original install failure to investigate installer/worker memory pressure. Do not rerun installation or migrations until the memory issue has an agreed next diagnostic/recovery step.

The user's diagnostic has now succeeded on hosted Node 22.23.2 (roughly 53 MiB RSS). One controlled reduced-concurrency retry is proposed: set `PNPM_MAX_WORKERS` to `1` in the application's environment controls, then select `hosting:install` with `--network-concurrency=1 --child-concurrency=1` in Specify parameters. Check the output echoes those flags on the pnpm install command. The worker variable was verified in the installed pnpm 11.10.0 source; do not substitute `PNPM_WORKERS`, which has different semantics. This reduces concurrent work, not the operating-system address-space limit, and is not a guaranteed fix. Keep the frozen lockfile, disabled lifecycle scripts and supply-chain checks. Do not increase the heap limit. If this retry fails with the same OOM, stop for provider review rather than repeating it. Remove the temporary worker environment setting after troubleshooting if no longer required.

Install using the existing pnpm lockfile, pinned pnpm and production dependencies:

```sh
npx --yes pnpm@11.10.0 install --prod --frozen-lockfile --ignore-scripts
```

In this panel, select **hosting:install** and leave parameters empty; the command above is shown only to explain what the script executes. npm invokes the script, while pnpm performs dependency installation. This intentionally does not use plain npm install, which would ignore the pnpm lockfile. [pnpm installation/version guidance](https://pnpm.io/installation)

If the field accepts only JS filenames or the host blocks npx/pnpm, stop and share the sanitized error and field label. Do not switch package managers, delete the panel-managed node_modules symlink, or enable install hooks to work around a failure. Shared-hosting symlink/resource constraints still need verification.

Once installation succeeds, take a backup/export if the hosted test database contains anything worth keeping, then run the explicit migration:

```sh
node dist/database/migrate.js up
```

In this panel, select **hosting:migrate** with parameters empty, only after installation succeeds. Expected output: `Database migration completed`, with successful exit status. This command does not build on the server or need devDependencies. Repeating it should succeed without reapplying existing migrations. It must receive the same database configuration as the API. Never place migration execution in an install/startup hook or expose it as a public HTTP route. Do not select start, start:dev, start:debug or start:prod here; Passenger's controls manage the server process. hosting:package is a local Windows build command, not a hosting command.

## 5. Restart and verify

Use the panel's Restart control, then open:

- `https://dev.sifulabs.co.ke/api/health/live`: HTTP 200, `{"status":"ok"}`.
- `https://dev.sifulabs.co.ke/api/health/ready`: HTTP 200, `{"status":"ok","database":"reachable"}`.

Readiness 503 means connectivity is unavailable; liveness alone does not prove database access. Both responses must include Cache-Control: no-store. Readiness does not check schema currency. Verify app_metadata and pgmigrations through the hosting PostgreSQL UI after migration. The root URL still returns the starter Hello World response; there is no frontend in this archive.

Verify a trusted HTTPS certificate, requests from phone mobile data, restart and idle recovery. Record Node/PostgreSQL/Passenger versions where available, resource limits and sanitized results. Do not share screenshots of environment-variable values or raw database errors containing credentials.

## 6. Recovery and remaining gates

Keep the previous release archive. For code rollback, stop the test application, restore the previous release's files/dependencies without deleting provider-managed links or server environment settings, then restart and check health. Do not combine incompatible code and schema. Production-mode database rollback is intentionally refused; prefer a reviewed forward migration or restore a backup into a separate database and verify it before repointing the test application. Never change NODE_ENV just to bypass rollback protection.

Before this hosting gate is complete, demonstrate backup/export and restore into a **separate** test database, verify the application marker/migration history there, and record retention and recovery ownership. Do not drop or overwrite the source database. The React frontend, SPA routing, authentication/cookies and business workflows require later implementation/verification. This guide does not mark them complete.
