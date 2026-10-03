CREATE TABLE IF NOT EXISTS route_payment_mandates (
  id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL UNIQUE REFERENCES route_plans(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  owner_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL, request_hash TEXT NOT NULL, route_hash TEXT NOT NULL,
  terms_json TEXT NOT NULL, max_aggregate_minor INTEGER NOT NULL,
  reserved_minor INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'active',
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS route_payment_mandates_owner_reference_idx ON route_payment_mandates(owner_account_id, client_reference);
CREATE TABLE IF NOT EXISTS route_funding_steps (
  id TEXT PRIMARY KEY NOT NULL,
  mandate_id TEXT NOT NULL REFERENCES route_payment_mandates(id) ON DELETE RESTRICT,
  route_id TEXT NOT NULL UNIQUE REFERENCES route_plans(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE RESTRICT,
  trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL, terms_hash TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'reserved',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
