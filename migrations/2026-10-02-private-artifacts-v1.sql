CREATE TABLE IF NOT EXISTS private_artifacts (
  id TEXT PRIMARY KEY NOT NULL, trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE RESTRICT,
  order_id TEXT REFERENCES service_orders(id) ON DELETE RESTRICT, route_id TEXT REFERENCES route_plans(id) ON DELETE RESTRICT,
  delivery_id TEXT REFERENCES trade_deliveries(id) ON DELETE RESTRICT, uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL, request_hash TEXT NOT NULL, name TEXT NOT NULL, media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, provenance_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, retention_expires_at INTEGER NOT NULL, purged_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS private_artifacts_trade_reference_idx ON private_artifacts(trade_id, client_reference);
CREATE INDEX IF NOT EXISTS private_artifacts_retention_idx ON private_artifacts(retention_expires_at, purged_at);
CREATE TABLE IF NOT EXISTS private_artifact_payloads (
  artifact_id TEXT PRIMARY KEY NOT NULL REFERENCES private_artifacts(id) ON DELETE RESTRICT,
  ciphertext TEXT NOT NULL, nonce TEXT NOT NULL
);
