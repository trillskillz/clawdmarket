CREATE TABLE IF NOT EXISTS seller_payment_preferences (
  seller_id TEXT PRIMARY KEY NOT NULL,
  supported_rails TEXT NOT NULL CHECK (json_valid(supported_rails) AND json_type(supported_rails) = 'array'),
  confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS marketplace_cohort_attributions (
  id TEXT PRIMARY KEY NOT NULL,
  principal_id TEXT NOT NULL,
  cohort TEXT NOT NULL CHECK (cohort IN ('platform_reference','platform_demo','platform_canary','ownership_unverified','independence_verified')),
  owner_group TEXT,
  evidence_ref TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  expires_at TEXT,
  CHECK (cohort <> 'independence_verified' OR (expires_at IS NOT NULL AND owner_group IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS marketplace_cohort_principal_time_idx ON marketplace_cohort_attributions(principal_id, recorded_at);
CREATE TRIGGER IF NOT EXISTS marketplace_cohort_no_update BEFORE UPDATE ON marketplace_cohort_attributions BEGIN SELECT RAISE(ABORT, 'Cohort attributions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS marketplace_cohort_no_delete BEFORE DELETE ON marketplace_cohort_attributions BEGIN SELECT RAISE(ABORT, 'Cohort attributions are append-only'); END;
