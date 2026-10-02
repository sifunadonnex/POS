# HostPinnacle: isolated backend deployment proof

Target: `https://dev.sifulabs.co.ke/`. The combined package contains the compiled NestJS API, migrations and compiled React frontend. It is still an isolated test deployment, not a production-ready POS. Hosting verification remains pending until the checks below pass. The user uploads files and runs panel commands; no SSH is required if the panel supports these commands with application environment variables.

## 1. Build the upload package locally

From `backend/` on Windows:

```powershell
pnpm run hosting:package
```

This builds both projects locally and produces a timestamped `.local/releases/<id>/pay-and-go-backend.zip`. Its allowlist contains `app.cjs`, compiled backend `.js` files in `dist/`, SQL files in `migrations/`, the compiled frontend in `public/`, package.json, pnpm-lock.yaml and this guide as DEPLOYMENT.md. It excludes local environment files, credentials, node_modules, npm lockfiles, source maps, tests and Git history. Do not upload the repository or local node_modules instead. Do not add credentials to this archive.

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

Extract the archive **inside the application root**: app.cjs, package.json, dist/ and public/ must be immediate children, not inside an extra backend/ directory. Replace only the newly generated placeholder startup file if the panel creates one. Do not overwrite unrelated files or the panel's node_modules link.

The wrapper dynamically imports the compiled ESM entrypoint. This follows the [CloudLinux Passenger ESM workaround](https://docs.cloudlinux.com/cloudlinuxos/cloudlinux_os_components/#limitations), but local wrapper success is not proof of the provider's Passenger behavior. Passenger owns process startup/restart; do not run a second long-lived `npm start` process in the command box.

## 3. Configure the Aiven test database and environment

HostPinnacle has upgraded its local database endpoint to PostgreSQL 13.23 at `127.0.0.200:5432`. This version is likely compatible with the current SQL after a static review, but compatibility has not been run-tested and PostgreSQL 13 is already end-of-life. Continue with the user's Aiven Free PostgreSQL service for this isolated proof. This temporary choice does not make the free service a production availability or offline-checkout solution.

Do not substitute the cPanel endpoint in the following settings without a separate decision and verification pass. The application currently permits disabled database TLS only for the exact hosts `localhost`, `127.0.0.1` and `[::1]`; cPanel's `127.0.0.200` is in the IPv4 loopback range but is not yet accepted by that guard. Supporting it safely requires a reviewed parser/test change or provider-confirmed certificate-verified TLS.

In Aiven's service Overview/Quick Connect, confirm the service is running and download the project CA certificate (`ca.pem`). Upload it outside `public_html` and outside the replaceable application-release directory, for example `/home/CPANEL_USER/private/pay-and-go/aiven-ca.pem`, substituting the account's actual absolute home path. Limit the directory and file to the hosting account (for example, directory mode `700` and file mode `600`). The CA certificate is not a password, but it must not be publicly served. Do not upload the service URL, a `.env` file or credentials with the release archive.

Use the Aiven service URI as the source for the connection values. The copied URI normally ends in `?sslmode=require`; remove that entire suffix before saving `DATABASE_URL`. Preserve every other character, including percent-encoded credential characters. This application rejects database URL queries/fragments and enforces the stronger certificate-verifying TLS mode separately. Never paste the URI into chat, screenshots or shell commands that will remain in history.

Set these privately in the application's environment-variable controls:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` (normally set by Application mode) |
| `DATABASE_URL` | The Aiven `postgresql://USER:PASSWORD@HOST:PORT/DATABASE` URI with the complete `?sslmode=require` suffix removed; no other query or fragment |
| `DATABASE_TLS` | `verify` |
| `DATABASE_POOL_MAX` | `3` initially; Aiven Free currently allows 20 total connections, including reserved/admin use and every application process |
| `NODE_EXTRA_CA_CERTS` | The actual absolute path to the uploaded Aiven CA, such as `/home/CPANEL_USER/private/pay-and-go/aiven-ca.pem` |
| `BETTER_AUTH_SECRET` | A unique random secret of at least 32 characters, stored only in the panel environment |
| `BETTER_AUTH_URL` | `https://dev.sifulabs.co.ke` (HTTPS origin only; no path, query, fragment or credentials) |
| `AUTH_EMAIL_ENABLED` | `false` until SMTP delivery is configured and verified |
| `DARAJA_ENABLED` | `false` until the complete sandbox callback/reconciliation checklist passes |

`NODE_EXTRA_CA_CERTS` is read when Node starts. Save all environment values before running the migration, and restart the Passenger application after any CA-path change. The panel migration script must receive the same environment as the application. Do not add `sslmode` back to the URL, use `DATABASE_TLS=disable`, or disable certificate verification to work around a connection error.

Do not override a provider-supplied application `PORT`. Our default is 3000 if it is absent; Passenger's listen behavior must be verified on hosting. If the host supplies a non-numeric socket value, stop and report the format without secrets so the bootstrap can be adapted.

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

Before starting or restarting Passenger, select **hosting:check-config** with parameters empty. It validates the database, TLS and authentication settings and confirms that the configured Aiven CA file is readable. It never prints environment values, credentials, the database hostname or the CA path. Expected output:

```text
Hosted configuration validated: database, TLS and authentication settings are present.
```

If it reports an invalid setting, correct that named setting and rerun the check. This check does not connect to the database or prove Passenger routing; the migration and health endpoints cover those separate gates.

Once installation succeeds, confirm the Aiven service is running and that all database/TLS environment variables above are available to the selected application. Take a backup/export first if the isolated database contains anything worth keeping, then run the explicit migration:

```sh
node dist/database/migrate.js up
```

In this panel, select **hosting:migrate** with parameters empty, only after installation succeeds. Expected output: `Database migration completed`, with successful exit status. This command does not build on the server or need devDependencies. Repeating it should succeed without reapplying existing migrations. It must receive the same database configuration as the API. Never place migration execution in an install/startup hook or expose it as a public HTTP route. Do not select start, start:dev, start:debug or start:prod here; Passenger's controls manage the server process. hosting:package is a local Windows build command, not a hosting command.

## 5. Restart and verify

Use the panel's Restart control, then open:

- `https://dev.sifulabs.co.ke/api/health/live`: HTTP 200, `{"status":"ok"}`.
- `https://dev.sifulabs.co.ke/api/health/ready`: HTTP 200, `{"status":"ok","database":"reachable"}`.

Readiness 503 means connectivity is unavailable; liveness alone does not prove database access. Both responses must include Cache-Control: no-store. Readiness does not check schema currency. Verify `app_metadata` and `pgmigrations` through Aiven's database tools after migration. The root URL must render the Pay & Go staff portal with `Cache-Control: no-store`; fingerprinted files under `/assets/` must use long-lived immutable caching. API routes remain under `/api` and authoritative API responses retain their own cache rules.

On 2 October 2026, the first requests connected to LiteSpeed but timed out while Passenger returned no bytes. One deliberate stop/start from the cPanel application controls recovered the process; external HTTP/1.1 checks then returned the expected HTTP 200 JSON responses from both endpoints. If this recurs after a deployment, check `hosting:check-config` and the private Passenger log, perform at most one controlled stop/start, and investigate repeated failures rather than increasing LiteSpeed's connection timeout or rerunning migrations.

Verify a trusted HTTPS certificate, requests from phone mobile data, restart and idle recovery. Record Node/PostgreSQL/Passenger versions where available, resource limits and sanitized results. Do not share screenshots of environment-variable values or raw database errors containing credentials.

## 6. Bootstrap the first hosted manager

Local development users are not copied into Aiven. Public registration remains disabled. The hosted bootstrap is deliberately limited to one verified manager and refuses to run once any user exists.

In the application root, use File Manager to create a private `.local` directory and `.local/initial-manager.env`. Do not create this file under `public/` or `public_html`. Enter:

```dotenv
STAFF_NAME=Shop Manager
STAFF_EMAIL=an_address_you_control@example.com
STAFF_PASSWORD=a_unique_password_between_12_and_128_characters
STAFF_ROLE=manager
STAFF_PROVISIONED_BY=cpanel-owner
STAFF_BOOTSTRAP_CONFIRM=CREATE_INITIAL_VERIFIED_MANAGER
STAFF_BOOTSTRAP_ATTEST_EMAIL_CONTROL=true
```

Use an email address you control. The final attestation explicitly records that the cPanel operator is treating this address as verified for the one-time bootstrap; it does not send an email. Restrict the directory to mode `700` and the file to `600` where cPanel exposes permissions. Select **hosting:bootstrap-manager** with no parameters. Expected output:

```text
Initial hosted manager created and marked verified. Delete .local/initial-manager.env now.
```

Immediately delete the plaintext file, then sign in at `https://dev.sifulabs.co.ke/`. Enroll authenticator MFA, save the recovery codes somewhere separate and confirm an authenticator code before using manager features. The command is transactionally audit-recorded and refuses a second run. Do not change `NODE_ENV`, enable public signup, edit password hashes manually or retain the bootstrap file as a workaround.

Bootstrap failures report only a safe category. `invalid-input` means check the name, email syntax, 12–128-character password, exact lowercase `manager` role and provisioned-by label without sharing their values. `invalid-confirmation` means copy both confirmation lines exactly. `users-exist` means an account is already present: stop and identify/recover that account rather than deleting data or repeating provisioning. `database write failed` means the transaction rolled back and the private server log/database permissions need inspection.

With SMTP still disabled, this bootstrapped manager can test the hosted UI, but normal new-staff verification/password setup cannot complete. Configure and verify SMTP before onboarding other staff through **Staff accounts**. Until then, do not create placeholder cashier accounts that operators cannot securely activate.

## 7. Recovery and remaining gates

Keep the previous release archive. For code rollback, stop the test application, restore the previous release's files/dependencies without deleting provider-managed links or server environment settings, then restart and check health. Do not combine incompatible code and schema. Production-mode database rollback is intentionally refused; prefer a reviewed forward migration or restore a backup into a separate database and verify it before repointing the test application. Never change NODE_ENV just to bypass rollback protection.

Before this hosting gate is complete, demonstrate backup/export and restore into a **separate** test database, verify the application marker/migration history there, and record retention and recovery ownership. Do not drop or overwrite the source database. The React frontend, SPA routing, authentication/cookies and business workflows require later implementation/verification. This guide does not mark them complete.
