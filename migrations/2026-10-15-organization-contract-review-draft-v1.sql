-- New explicit review only. No historical authority or funding/release permission.
CREATE TABLE IF NOT EXISTS organization_contract_authorizations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  contract_id TEXT NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE RESTRICT,
  owner_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  team_id TEXT REFERENCES organization_teams(id) ON DELETE RESTRICT,
  cost_center TEXT NOT NULL,
  reviewer_role_id TEXT NOT NULL REFERENCES organization_purchasing_roles(id) ON DELETE RESTRICT,
  reviewer_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL, request_hash TEXT NOT NULL,
  authority_hash TEXT NOT NULL, terms_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','revoked')),
  decision_reference TEXT, decision_hash TEXT,
  created_at INTEGER NOT NULL, approved_at INTEGER, revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_contract_org_reference_idx
  ON organization_contract_authorizations(organization_id, client_reference);
