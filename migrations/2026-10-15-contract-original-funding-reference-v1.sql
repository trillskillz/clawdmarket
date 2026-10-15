-- Do not infer a request from an earlier funded state, attribution or reservation.
CREATE TABLE IF NOT EXISTS organization_contract_funding_requests (
  id TEXT PRIMARY KEY NOT NULL,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  authorization_id TEXT NOT NULL UNIQUE REFERENCES organization_contract_uses(authorization_id) ON DELETE RESTRICT,
  contract_id TEXT NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL, request_hash TEXT NOT NULL, authority_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_contract_funding_buyer_reference_idx
  ON organization_contract_funding_requests(buyer_id, client_reference);
CREATE TRIGGER IF NOT EXISTS reviewed_contract_funding_reference_immutable_update
  BEFORE UPDATE ON organization_contract_funding_requests BEGIN SELECT RAISE(ABORT, 'reviewed_contract_funding_reference_immutable'); END;
CREATE TRIGGER IF NOT EXISTS reviewed_contract_funding_reference_immutable_delete
  BEFORE DELETE ON organization_contract_funding_requests BEGIN SELECT RAISE(ABORT, 'reviewed_contract_funding_reference_immutable'); END;
