CREATE TABLE IF NOT EXISTS organization_team_budgets (
  team_id TEXT PRIMARY KEY NOT NULL REFERENCES organization_teams(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  max_per_execution_minor INTEGER CHECK (max_per_execution_minor IS NULL OR max_per_execution_minor > 0),
  max_daily_minor INTEGER CHECK (max_daily_minor IS NULL OR max_daily_minor > 0),
  max_monthly_minor INTEGER CHECK (max_monthly_minor IS NULL OR max_monthly_minor > 0),
  version INTEGER NOT NULL CHECK (version > 0), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_team_budget_events (
  id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  team_id TEXT NOT NULL REFERENCES organization_teams(id) ON DELETE RESTRICT,
  actor_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL, old_budget_json TEXT, new_budget_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS team_budget_events_team_version_idx ON organization_team_budget_events(team_id, version);
CREATE TABLE IF NOT EXISTS organization_contract_attributions (
  contract_id TEXT PRIMARY KEY NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  agent_id TEXT NOT NULL, team_id TEXT, cost_center TEXT NOT NULL,
  total_minor INTEGER NOT NULL CHECK (total_minor > 0), created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS organization_contract_attributions_team_created_idx ON organization_contract_attributions(organization_id, team_id, created_at);
