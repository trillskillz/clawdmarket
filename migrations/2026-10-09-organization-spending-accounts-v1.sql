CREATE TABLE IF NOT EXISTS organization_spending_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  owner_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  buyer_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  team_id TEXT REFERENCES organization_teams(id) ON DELETE RESTRICT,
  cost_center TEXT NOT NULL, client_reference TEXT NOT NULL, name TEXT NOT NULL,
  allowed_services_json TEXT NOT NULL,
  max_purchase_minor INTEGER NOT NULL, max_daily_minor INTEGER NOT NULL,
  max_monthly_minor INTEGER NOT NULL, max_lifetime_minor INTEGER NOT NULL,
  authority_hash TEXT NOT NULL, credential_hash TEXT NOT NULL, credential_prefix TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active', expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER,
  CHECK(max_purchase_minor>0 AND max_daily_minor>0 AND max_monthly_minor>0 AND max_lifetime_minor>0)
);
CREATE UNIQUE INDEX IF NOT EXISTS spending_accounts_org_reference_idx ON organization_spending_accounts(organization_id,client_reference);
CREATE UNIQUE INDEX IF NOT EXISTS spending_accounts_credential_idx ON organization_spending_accounts(credential_hash);
CREATE INDEX IF NOT EXISTS spending_accounts_org_state_idx ON organization_spending_accounts(organization_id,state);
CREATE TABLE IF NOT EXISTS organization_spending_uses (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES service_orders(id) ON DELETE RESTRICT,
  trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES organization_spending_accounts(id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL, buyer_id TEXT NOT NULL, amount_minor INTEGER NOT NULL, created_at INTEGER NOT NULL,
  CHECK(amount_minor>0)
);
CREATE INDEX IF NOT EXISTS spending_uses_account_created_idx ON organization_spending_uses(account_id,created_at);
CREATE INDEX IF NOT EXISTS service_orders_spending_account_idx ON service_orders(organization_spending_account_id);
