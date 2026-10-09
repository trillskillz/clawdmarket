CREATE TABLE IF NOT EXISTS organization_provider_shares (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  organization_owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  service_id TEXT NOT NULL REFERENCES service_definitions(id) ON DELETE RESTRICT,
  team_id TEXT REFERENCES organization_teams(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  accept_reference TEXT,
  accept_hash TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  revoked_at INTEGER,
  revoked_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_shares_owner_reference_idx ON organization_provider_shares(provider_owner_id, client_reference);
CREATE INDEX IF NOT EXISTS provider_shares_org_state_idx ON organization_provider_shares(organization_id, state);
CREATE INDEX IF NOT EXISTS provider_shares_service_state_idx ON organization_provider_shares(service_id, state);
