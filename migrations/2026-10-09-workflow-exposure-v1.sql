CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY NOT NULL, workflow_id TEXT NOT NULL UNIQUE REFERENCES workflows(id) ON DELETE RESTRICT,
  approval_id TEXT NOT NULL UNIQUE REFERENCES workflow_approvals(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  owner_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL, request_hash TEXT NOT NULL, contract_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'authorized' CHECK(state IN ('authorized','cancelled')),
  gross_reserved_minor INTEGER NOT NULL DEFAULT 0 CHECK(gross_reserved_minor >= 0),
  chain_fee_reserved_units TEXT NOT NULL DEFAULT '0', started_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_owner_reference_idx ON workflow_runs(owner_account_id, client_reference);
CREATE TABLE IF NOT EXISTS workflow_node_runs (
  id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  workflow_node_id TEXT NOT NULL UNIQUE REFERENCES workflow_nodes(id) ON DELETE RESTRICT,
  node_key TEXT NOT NULL, planned_route_id TEXT NOT NULL UNIQUE,
  route_id TEXT UNIQUE REFERENCES route_plans(id) ON DELETE RESTRICT,
  mandate_id TEXT UNIQUE REFERENCES route_payment_mandates(id) ON DELETE RESTRICT,
  route_hash TEXT, terms_hash TEXT, state TEXT NOT NULL CHECK(state IN ('ready','blocked','reserved')),
  gross_reserved_minor INTEGER NOT NULL DEFAULT 0 CHECK(gross_reserved_minor >= 0),
  chain_fee_reserved_units TEXT NOT NULL DEFAULT '0', attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  deadline_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_node_runs_key_idx ON workflow_node_runs(run_id, node_key);
CREATE TABLE IF NOT EXISTS workflow_reservations (
  id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  node_run_id TEXT NOT NULL REFERENCES workflow_node_runs(id) ON DELETE RESTRICT,
  route_id TEXT NOT NULL REFERENCES route_plans(id) ON DELETE RESTRICT,
  mandate_id TEXT NOT NULL REFERENCES route_payment_mandates(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL UNIQUE REFERENCES service_orders(id) ON DELETE RESTRICT,
  trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), chain_fee_units TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 3), terms_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_reservations_attempt_idx ON workflow_reservations(node_run_id, attempt_number);
