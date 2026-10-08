-- Up Migration
CREATE TABLE edge_staff_enrollment_grant (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES store_bootstrap_state(store_id),
  staff_id text NOT NULL REFERENCES "user"(id),
  manager_id text NOT NULL REFERENCES "user"(id),
  manager_session_id text NOT NULL,
  generation integer NOT NULL CHECK (generation > 0),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > issued_at),
  CHECK (consumed_at IS NULL OR revoked_at IS NULL)
);
CREATE UNIQUE INDEX edge_staff_enrollment_one_open
  ON edge_staff_enrollment_grant (store_id, staff_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

ALTER TABLE store_bootstrap_audit DROP CONSTRAINT store_bootstrap_audit_action_check;
ALTER TABLE store_bootstrap_audit ADD CONSTRAINT store_bootstrap_audit_action_check
  CHECK (action IN ('snapshot.published', 'snapshot.applied', 'manager.enrolled',
    'opening.signed-off', 'cutover.issued', 'cutover.activated',
    'generation.fenced', 'generation.activated',
    'staff.enrollment-granted', 'staff.enrolled'));

-- Down Migration
ALTER TABLE store_bootstrap_audit DROP CONSTRAINT store_bootstrap_audit_action_check;
ALTER TABLE store_bootstrap_audit ADD CONSTRAINT store_bootstrap_audit_action_check
  CHECK (action IN ('snapshot.published', 'snapshot.applied', 'manager.enrolled',
    'opening.signed-off', 'cutover.issued', 'cutover.activated',
    'generation.fenced', 'generation.activated'));
DROP TABLE edge_staff_enrollment_grant;
