-- Explicit new buyer decisions only. No inferred historical acceptance or money movement.
CREATE TABLE IF NOT EXISTS contract_acceptance_operations (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL UNIQUE REFERENCES contract_submission_operations(submission_id) ON DELETE RESTRICT,
  authorization_id TEXT NOT NULL REFERENCES organization_contract_uses(authorization_id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  milestone_id TEXT NOT NULL REFERENCES contract_milestones(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL, request_hash TEXT NOT NULL, content_hash TEXT NOT NULL,
  accepted_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS contract_acceptance_buyer_reference_idx
  ON contract_acceptance_operations(buyer_id, client_reference);
CREATE TRIGGER IF NOT EXISTS reviewed_contract_acceptance_immutable_update
  BEFORE UPDATE ON contract_acceptance_operations BEGIN
  SELECT RAISE(ABORT, 'reviewed_contract_acceptance_immutable'); END;
CREATE TRIGGER IF NOT EXISTS reviewed_contract_acceptance_immutable_delete
  BEFORE DELETE ON contract_acceptance_operations BEGIN
  SELECT RAISE(ABORT, 'reviewed_contract_acceptance_immutable'); END;
