-- Up Migration
-- Better Auth 1.7.4 core schema + database rate limiter; reviewed explicit SQL.
CREATE TABLE "user" (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false, image text,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  role text NOT NULL DEFAULT 'cashier' CHECK (role IN ('manager', 'cashier'))
);
CREATE UNIQUE INDEX user_email_normalized ON "user" (lower(email));
CREATE TABLE session (
  id text PRIMARY KEY, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE, "expiresAt" timestamptz NOT NULL,
  "ipAddress" text, "userAgent" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_user_id ON session ("userId");
CREATE TABLE account (
  id text PRIMARY KEY, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accountId" text NOT NULL, "providerId" text NOT NULL,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  scope text, password text,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX account_user_id ON account ("userId");
CREATE TABLE verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier ON verification (identifier);
CREATE TABLE "rateLimit" (
  id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL,
  "lastRequest" bigint NOT NULL
);
CREATE TABLE identity_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id),
  action text NOT NULL CHECK (action = 'staff.provisioned'),
  actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
-- Destructive: removes all accounts and sessions; local/test rollback only.
DROP TABLE identity_audit, "rateLimit", verification, account, session, "user";
