# Local staff authentication

## Status and scope

Login/security implementation now includes email verification, password recovery/change, authenticator MFA and recovery codes, staff administration, account suspension/session revocation, security history, and a 15-minute inactivity lock. Managers must complete MFA before using protected features. Cashiers may enable MFA.

**PostgreSQL is not installed on this machine**, confirmed by the user on 15 September 2026. Installation, migrations, provisioning and real database tests are deferred. SMTP delivery and connected browser checks are also unverified. Passing mocked tests/builds does not establish working login against PostgreSQL.

No public registration, social login, paid identity service, checkout, business reports or branch/till permissions. Hosting troubleshooting remains deferred.

## Configure the existing SMTP mailbox privately

The user selected an existing SMTP mailbox. Add its actual settings in ignored `backend/.env`, using `backend/.env.example` as the template:

| Variable | Purpose |
| --- | --- |
| AUTH_EMAIL_ENABLED | Keep `false` until ready; set `true` to enable queued delivery |
| SMTP_HOST | Mail provider's SMTP hostname |
| SMTP_PORT | `465` for implicit TLS or `587` for required STARTTLS |
| SMTP_USER | Mailbox login |
| SMTP_PASSWORD | Mailbox/app password, stored only in private server configuration |
| SMTP_FROM | Bare sender email address authorized for this mailbox |
| BETTER_AUTH_URL | Exact browser origin; local default `http://localhost:5173` |

Never put these credentials in `VITE_*`, screenshots, command arguments or chat. Certificate verification is required; there is no insecure SMTP fallback. Nodemailer 10.0.10 is pinned (MIT-0, Node >=20), with types 8.0.1. No real email is sent by the automated suites.

With delivery disabled, reset/verification requests return an explicit unavailable error. Existing verified accounts can still sign in; new unverified accounts cannot.

### Delivery behavior

- Recovery and verification tokens expire after 30 minutes. Links use a first-party URL fragment; the screen removes it from the address bar and requires an explicit submit/verify action.
- Requests save encrypted payloads in PostgreSQL `auth_mail_outbox`. The stable `BETTER_AUTH_SECRET` also protects these payloads and MFA secrets; protect its backup and plan rotation deliberately.
- While the local backend is running, a bounded worker checks every 10 seconds, claims up to five jobs, and retries up to three attempts with a one-minute delay. Expired jobs and completed/finally failed jobs lose their encrypted payload.
- Jobs survive application restarts; crashed claims can be retried after five minutes. SMTP acceptance followed by a database failure can produce duplicate email. Duplicate links do not mean another account or password was created.
- The UI confirms a request, not delivery. Security history records `email.smtp-accepted` or `email.delivery-failed`; acceptance by SMTP does not prove inbox arrival. Check the test inbox/spam folder later.
- The current worker requires a running Node process. HostPinnacle scheduling, recycling, outbound SMTP and delivery after restart must be verified before relying on hosted delivery.

## Start later, after PostgreSQL is available

Configure separate development and test databases using [backend setup](BACKEND_SETUP.md). From `backend/`:

```powershell
pnpm run auth:setup
pnpm run db:migrate
```

`auth:setup` appends missing auth secret/origin values only, preserves existing values, prints no secrets, and refuses non-loopback/non-`_dev` configuration. No migration runs at application startup.

Create `backend/.local/staff.env` privately:

```dotenv
STAFF_NAME=Shop Manager
STAFF_EMAIL=your_test_mailbox_address
STAFF_PASSWORD=choose_a_unique_password_of_12_to_128_characters
STAFF_ROLE=manager
STAFF_PROVISIONED_BY=local-developer
```

Use an inbox you control to test verification. Then:

```powershell
pnpm run auth:provision
pnpm run start:dev
```

Provisioning creates a hashed-password account atomically, rejects duplicate email, and refuses remote/production databases. It does not mark the email verified. Remove the plaintext staff file after provisioning.

From `frontend/`, run `pnpm run dev` and open `http://localhost:5173`. Vite proxies `/api` to `127.0.0.1:3000`; the browser origin must exactly match `BETTER_AUTH_URL`.

1. Request email verification from the sign-in screen, open the link and explicitly verify.
2. Sign in with the provisioned password.
3. A manager must enroll an authenticator, securely save recovery codes, and confirm a code before opening manager tools.
4. Create other staff from **Staff accounts**. New accounts receive a random, undisclosed initial password; explicitly request verification and password-setup links.
5. Staff verify the email and choose their password using the links. New managers must enroll MFA.

## Account and session controls

- Better Auth is pinned to 1.7.4 in both projects; the Nest wrapper resolves to 2.8.0. Installed types/schema/source were inspected against the official email/password, hooks and MFA documentation.
- All Nest routes are protected by default. Root, health and nonsensitive identity options are explicit public routes. Manager staff/audit routes require current manager role and MFA proof stored on that particular session.
- Authentication and business writes require the exact trusted Origin. Signup, direct profile/role mutation, trusted-device bypass, email OTP and user-driven MFA disabling are blocked.
- Cookies are HttpOnly, SameSite=Lax, nonpersistent and Secure on HTTPS. No browser-stored credentials or session cookie cache. Sessions are capped at eight hours when created and may refresh while active.
- Server idle expiry is 15 minutes. Actual keyboard/touch/pointer activity sends a heartbeat; polling does not keep the session alive. Lock/sign-out immediately hides private screens; failed sign-out stays locked until it can be confirmed.
- Password changes, role changes, suspension and MFA resets revoke affected sessions. Staff writes recheck the acting manager inside their transaction. Edits carry a revision so stale changes are rejected.
- Sensitive staff actions require the manager's current password and a recorded reason. Self-demotion, self-suspension and self MFA reset are refused; administration serializes changes to protect the last active manager.
- An enrolled staff member can use a saved recovery code when the authenticator is unavailable. Another verified manager can reset their MFA. There is no unauthenticated MFA bypass; keep recovery codes secure, especially for the sole manager.
- Sign-in allows five attempts/minute per socket IP, with tighter email limits. Client IP headers are overwritten. Local Vite users share the proxy limit; hosted proxy/IP attribution remains deferred.
- Auth outcomes, session/password/account mutations and SMTP outcomes produce sanitized audit records. Staff actions include actor and reason. A database trigger prevents audit UPDATE/DELETE; a privileged database owner can still bypass database controls.
- App logs omit raw provider/database errors and tokens. Hosted access logs must also avoid recording auth query strings. The original provisioning audit retains its operator-supplied label; manager actions use authenticated actor IDs.

## Migration impact and deferred checks

`202609150002_identity_security.sql` adds MFA fields/table, session policy fields, staff revision/status, append-only audit, durable email jobs and revocation triggers. It is **written but unapplied on this machine**. Existing emails are not automatically verified. The down migration deletes MFA, queue and audit data; use only for deliberate disposable-test rollback.

Backend database-independent checks: `pnpm run test`, `pnpm run test:e2e`, `pnpm exec tsc --noEmit --incremental false`, `pnpm run lint`, `pnpm run build`. Frontend: `pnpm run test`, `pnpm run lint`, `pnpm run build` (includes referenced-project TypeScript).

Once PostgreSQL is available, run from `backend/`:

```powershell
node --env-file=.env.test node_modules/vitest/vitest.mjs run --config vitest.config.integration.ts
```

The explicit `TEST_DATABASE_URL` must end in `_test`; suites create/drop only uniquely named test schemas. The extended suite is unrun and may expose integration defects. Complete [the deferred security verification checklist](SECURITY_VERIFICATION.md) before treating this feature as connected and verified.

References: [Better Auth email/password](https://better-auth.com/docs/authentication/email-password), [MFA](https://better-auth.com/docs/plugins/2fa), [hooks](https://better-auth.com/docs/concepts/hooks), [Nodemailer SMTP](https://nodemailer.com/smtp), [Nodemailer licence](https://github.com/nodemailer/nodemailer/blob/master/LICENSE).
