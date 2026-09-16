# Security verification

**Updated: 16 September 2026.** PostgreSQL integration and local manager/cashier password login are verified. Real SMTP delivery, full MFA/recovery browser flows, visual checks, idle/offline behavior and hosted operation remain unverified.

## Completed locally

- PostgreSQL 18 is running with separate development and `_test` databases. All four migrations are applied to development.
- All 15 integration tests pass in disposable test schemas, including migration repeat/down/reapply, transaction rollback, account/audit controls, staff concurrency/revisions and catalogue transaction behavior.
- Disposable manager and cashier accounts both completed real password sign-in and authenticated `/api/identity/me` requests; the test sessions were signed out.

## PostgreSQL and authentication checks still required

- Test simultaneous login/suspension, stale staff edits, concurrent manager changes, password reset/reuse, and recovery-code reuse. Verify only one concurrent attempt consumes a reset token or recovery code.
- Verify manager enrollment, subsequent login challenge, wrong/expired codes, recovery codes, authenticator reset by another manager, password changes, and blocked trusted-device/direct-role/MFA bypass requests.
- Verify initial unverified accounts cannot sign in and disabled accounts cannot obtain sessions, including after email recovery. Confirm cashiers cannot read staff or audit records.
- Exercise encrypted queue claims with two workers, retries, final failure, expiry, crash/restart reclamation and payload clearing. No duplicate claim should run concurrently before its lease expires; SMTP acceptance followed by a failed database update can yield a duplicate email.

## Existing SMTP mailbox

- Configure credentials privately and use only controlled test recipients. Check TLS/STARTTLS, sender authorization, inbox/spam arrival, and correct local link origin.
- Request verification and reset links for known/unknown accounts; verify public responses do not disclose account existence. Test expired, malformed and reused links.
- Interrupt SMTP and restart the app with queued jobs. Confirm retry/failure records, eventual delivery and no plaintext tokens/passwords in logs, audit rows or queue payloads.
- Retain the stable auth secret securely; verify backup/recovery of MFA configuration before any live use.

## Browser and usability

- Inspect sign-in, recovery, MFA, staff administration and security history at phone/desktop widths in light/dark themes. Check keyboard operation, focus, long names/emails, errors, loading, empty and retry states.
- Test the full cookie flow with the real API: verification, login, MFA enrollment/challenge/recovery, password change, staff suspension and session revocation.
- Leave a session idle for 15 minutes; polling alone must not refresh activity. Test multiple tabs, sleeping computer, reload, offline lock, reconnect and failed sign-out. Protected content must remain hidden until the server accepts a valid session.
- Confirm recovered password/account updates display success only after a confirmed response; retries after unknown outcomes must not silently create duplicate accounts.

## Hosted pilot remains deferred

Do not run deployment scripts as part of these local checks. On user-directed resumption, verify HTTPS, exact origin/cookie handling, trusted proxy/IP limits, noncached auth responses, access-log redaction, PostgreSQL, background-job scheduling/process recycling, SMTP egress, phone access, and backup/restore. The local timer is not proof of reliable jobs on HostPinnacle.
