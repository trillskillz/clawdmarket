-- New explicit original buyer release facts only; never backfill legacy or admin outcomes.
CREATE TABLE IF NOT EXISTS contract_release_operations (
  id TEXT PRIMARY KEY NOT NULL,
  milestone_id TEXT NOT NULL UNIQUE REFERENCES contract_milestones(id) ON DELETE RESTRICT,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  authorization_id TEXT NOT NULL REFERENCES organization_contract_uses(authorization_id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL,
  acceptance_id TEXT NOT NULL REFERENCES contract_acceptance_operations(id) ON DELETE RESTRICT,
  submission_id TEXT NOT NULL REFERENCES contract_submission_operations(submission_id) ON DELETE RESTRICT,
  content_hash TEXT NOT NULL,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL, request_hash TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  settlement_entry_id TEXT NOT NULL REFERENCES credit_entries(id) ON DELETE RESTRICT,
  sale_entry_id TEXT NOT NULL REFERENCES credit_entries(id) ON DELETE RESTRICT,
  released_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS contract_release_buyer_reference_idx
  ON contract_release_operations(buyer_id, client_reference);
CREATE TRIGGER IF NOT EXISTS reviewed_contract_release_immutable_update
  BEFORE UPDATE ON contract_release_operations BEGIN
  SELECT RAISE(ABORT, 'reviewed_contract_release_immutable'); END;
CREATE TRIGGER IF NOT EXISTS reviewed_contract_release_immutable_delete
  BEFORE DELETE ON contract_release_operations BEGIN
  SELECT RAISE(ABORT, 'reviewed_contract_release_immutable'); END;
