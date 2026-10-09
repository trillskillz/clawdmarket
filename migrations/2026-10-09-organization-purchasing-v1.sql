CREATE TABLE IF NOT EXISTS organization_purchasing_roles (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  owner_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  team_id TEXT REFERENCES organization_teams(id) ON DELETE RESTRICT,
  role TEXT NOT NULL,
  max_purchase_minor INTEGER NOT NULL CHECK(max_purchase_minor>0),
  client_reference TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS purchasing_roles_org_reference_idx ON organization_purchasing_roles(organization_id, client_reference);
CREATE INDEX IF NOT EXISTS purchasing_roles_account_org_idx ON organization_purchasing_roles(account_id, organization_id);
CREATE TABLE IF NOT EXISTS organization_purchase_requests (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  owner_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  agent_id TEXT NOT NULL,
  team_id TEXT,
  cost_center TEXT NOT NULL,
  service_id TEXT NOT NULL REFERENCES service_definitions(id) ON DELETE RESTRICT,
  requester_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requester_role_id TEXT REFERENCES organization_purchasing_roles(id) ON DELETE RESTRICT,
  reviewer_role_id TEXT REFERENCES organization_purchasing_roles(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  service_hash TEXT NOT NULL,
  order_json TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  payment_rail TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  cancelled_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_requests_org_reference_idx ON organization_purchase_requests(organization_id, client_reference);
CREATE INDEX IF NOT EXISTS purchase_requests_buyer_created_idx ON organization_purchase_requests(buyer_id, created_at);
CREATE TABLE IF NOT EXISTS organization_purchase_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL UNIQUE REFERENCES organization_purchase_requests(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  owner_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approver_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approver_role_id TEXT REFERENCES organization_purchasing_roles(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  decision_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_approvals_org_reference_idx ON organization_purchase_approvals(organization_id, client_reference);
CREATE TABLE IF NOT EXISTS organization_purchase_uses (
  approval_id TEXT PRIMARY KEY NOT NULL REFERENCES organization_purchase_approvals(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL UNIQUE REFERENCES service_orders(id) ON DELETE RESTRICT,
  trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  created_at INTEGER NOT NULL
);
