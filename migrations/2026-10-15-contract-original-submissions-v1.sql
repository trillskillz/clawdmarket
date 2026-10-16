-- New reviewed submission references only; historical output gains no authority.
CREATE TABLE IF NOT EXISTS contract_submission_operations (
  submission_id TEXT PRIMARY KEY NOT NULL REFERENCES contract_submissions(id) ON DELETE RESTRICT,
  authorization_id TEXT NOT NULL REFERENCES organization_contract_uses(authorization_id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  milestone_id TEXT NOT NULL REFERENCES contract_milestones(id) ON DELETE RESTRICT,
  submitter_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL CHECK(length(client_reference) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL, content_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS contract_submission_submitter_reference_idx
  ON contract_submission_operations(submitter_id, client_reference);
CREATE TRIGGER IF NOT EXISTS reviewed_contract_submission_operation_immutable_update
  BEFORE UPDATE ON contract_submission_operations BEGIN
  SELECT RAISE(ABORT, 'reviewed_contract_submission_operation_immutable'); END;
CREATE TRIGGER IF NOT EXISTS reviewed_contract_submission_operation_immutable_delete
  BEFORE DELETE ON contract_submission_operations BEGIN
  SELECT RAISE(ABORT, 'reviewed_contract_submission_operation_immutable'); END;
CREATE TRIGGER IF NOT EXISTS reviewed_contract_submission_immutable_update
  BEFORE UPDATE ON contract_submissions
  WHEN EXISTS(SELECT 1 FROM contract_submission_operations o WHERE o.submission_id=OLD.id)
  BEGIN SELECT RAISE(ABORT, 'reviewed_contract_submission_immutable'); END;
CREATE TRIGGER IF NOT EXISTS reviewed_contract_submission_immutable_delete
  BEFORE DELETE ON contract_submissions
  WHEN EXISTS(SELECT 1 FROM contract_submission_operations o WHERE o.submission_id=OLD.id)
  BEGIN SELECT RAISE(ABORT, 'reviewed_contract_submission_immutable'); END;
