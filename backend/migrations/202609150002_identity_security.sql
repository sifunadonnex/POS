-- Up Migration
-- Better Auth 1.7.4 two-factor schema, plus application-owned security policy.
ALTER TABLE "user" ADD COLUMN disabled boolean NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE "user" ADD COLUMN "twoFactorEnabled" boolean NOT NULL DEFAULT false;
ALTER TABLE session ADD COLUMN "mfaVerified" boolean NOT NULL DEFAULT false;
ALTER TABLE session ADD COLUMN "lastActivityAt" timestamptz NOT NULL DEFAULT now();

CREATE TABLE "twoFactor" (
  id text PRIMARY KEY,
  "userId" text NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
  secret text NOT NULL,
  "backupCodes" text NOT NULL,
  verified boolean NOT NULL DEFAULT true,
  "failedVerificationCount" integer NOT NULL DEFAULT 0,
  "lockedUntil" timestamptz
);
CREATE INDEX two_factor_secret ON "twoFactor" (secret);

CREATE TABLE auth_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text,
  subject_id text,
  action text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure', 'challenge', 'denied')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_audit_created ON auth_audit (created_at DESC, id DESC);

-- Encrypted, short-lived email jobs avoid exposing account existence through SMTP response timing.
CREATE TABLE auth_mail_outbox (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id),
  payload text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_mail_ready ON auth_mail_outbox (status, available_at);

CREATE FUNCTION prevent_auth_audit_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Authentication audit records are append-only';
END;
$$;
CREATE TRIGGER auth_audit_immutable BEFORE UPDATE OR DELETE ON auth_audit
FOR EACH ROW EXECUTE FUNCTION prevent_auth_audit_changes();

CREATE FUNCTION audit_staff_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor text;
BEGIN
  actor := nullif(current_setting('paygo.actor_id', true), '');
  IF TG_OP = 'UPDATE' THEN
    NEW.revision := OLD.revision + 1;
    IF OLD.role IS DISTINCT FROM NEW.role OR OLD.disabled IS DISTINCT FROM NEW.disabled
       OR OLD."twoFactorEnabled" IS DISTINCT FROM NEW."twoFactorEnabled" THEN
      DELETE FROM session WHERE "userId" = NEW.id;
      DELETE FROM verification WHERE value = NEW.id;
    END IF;
  END IF;
  INSERT INTO auth_audit (actor_id, subject_id, action, outcome, detail)
    VALUES (actor, NEW.id, CASE WHEN TG_OP = 'INSERT' THEN 'staff.created' ELSE 'staff.changed' END,
      'success', jsonb_build_object('role', NEW.role, 'disabled', NEW.disabled,
      'emailVerified', NEW."emailVerified", 'twoFactorEnabled', NEW."twoFactorEnabled"));
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_staff BEFORE INSERT OR UPDATE ON "user"
FOR EACH ROW EXECUTE FUNCTION audit_staff_change();

CREATE FUNCTION audit_session_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id text;
BEGIN
  target_id := CASE WHEN TG_OP = 'INSERT' THEN NEW."userId" ELSE OLD."userId" END;
  IF TG_OP = 'INSERT' THEN
    -- Serializes login with account suspension; the suspended user cannot win a race.
    PERFORM id FROM "user" WHERE id = target_id AND disabled = false AND "emailVerified" = true FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Staff account cannot start a session'; END IF;
  END IF;
  INSERT INTO auth_audit (actor_id, subject_id, action, outcome)
    VALUES (coalesce(nullif(current_setting('paygo.actor_id', true), ''), target_id), target_id,
      CASE WHEN TG_OP = 'INSERT' THEN 'session.created' ELSE 'session.revoked' END, 'success');
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_session BEFORE INSERT OR DELETE ON session
FOR EACH ROW EXECUTE FUNCTION audit_session_change();

CREATE FUNCTION audit_password_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.password IS DISTINCT FROM NEW.password THEN
    -- Password mutation and session revocation commit together, including library reset flows.
    DELETE FROM session WHERE "userId" = NEW."userId";
    DELETE FROM verification WHERE value = NEW."userId";
    INSERT INTO auth_audit (actor_id, subject_id, action, outcome)
      VALUES (nullif(current_setting('paygo.actor_id', true), ''), NEW."userId", 'password.changed', 'success');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_password BEFORE UPDATE ON account
FOR EACH ROW EXECUTE FUNCTION audit_password_change();

-- Down Migration
-- Deliberate local/test rollback only: removes MFA enrolment and audit history.
DROP TRIGGER audit_password ON account;
DROP FUNCTION audit_password_change();
DROP TRIGGER audit_session ON session;
DROP FUNCTION audit_session_change();
DROP TRIGGER audit_staff ON "user";
DROP FUNCTION audit_staff_change();
DROP TABLE auth_mail_outbox;
DROP TABLE auth_audit;
DROP FUNCTION prevent_auth_audit_changes();
DROP TABLE "twoFactor";
ALTER TABLE session DROP COLUMN "mfaVerified", DROP COLUMN "lastActivityAt";
ALTER TABLE "user" DROP COLUMN "twoFactorEnabled", DROP COLUMN revision, DROP COLUMN disabled;
