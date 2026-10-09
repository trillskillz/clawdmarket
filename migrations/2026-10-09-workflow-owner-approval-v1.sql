CREATE TABLE IF NOT EXISTS workflow_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL UNIQUE REFERENCES workflows(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  owner_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL, request_hash TEXT NOT NULL, plan_hash TEXT NOT NULL,
  contract_hash TEXT NOT NULL, contract_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'approved' CHECK(state IN ('approved', 'revoked')),
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER,
  revoked_by TEXT REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_approvals_owner_reference_idx
  ON workflow_approvals(owner_account_id, client_reference);
