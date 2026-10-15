-- Historical original credit-use evidence only. No funding endpoint or permission.
CREATE TABLE IF NOT EXISTS organization_contract_uses (
  authorization_id TEXT PRIMARY KEY NOT NULL REFERENCES organization_contract_authorizations(id) ON DELETE RESTRICT,
  contract_id TEXT NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE RESTRICT,
  fee_recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL, client_reference TEXT NOT NULL, request_hash TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), created_at INTEGER NOT NULL
);
