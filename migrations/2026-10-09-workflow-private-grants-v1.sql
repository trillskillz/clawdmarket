CREATE TABLE IF NOT EXISTS workflow_dependency_bindings (
  id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  node_run_id TEXT NOT NULL REFERENCES workflow_node_runs(id) ON DELETE RESTRICT, target_field TEXT NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES private_artifacts(id) ON DELETE RESTRICT,
  binding_hash TEXT NOT NULL, binding_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_dependency_bindings_target_idx ON workflow_dependency_bindings(node_run_id, target_field);
CREATE TABLE IF NOT EXISTS workflow_artifact_grants (
  id TEXT PRIMARY KEY NOT NULL, binding_id TEXT NOT NULL REFERENCES workflow_dependency_bindings(id) ON DELETE RESTRICT,
  node_run_id TEXT NOT NULL REFERENCES workflow_node_runs(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE RESTRICT,
  trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE RESTRICT,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_artifact_grants_order_binding_idx ON workflow_artifact_grants(order_id, binding_id);
CREATE TABLE IF NOT EXISTS workflow_receipts (
  run_id TEXT PRIMARY KEY NOT NULL REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  contract_hash TEXT NOT NULL, content_hash TEXT NOT NULL, receipt_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
