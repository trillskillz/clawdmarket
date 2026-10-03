CREATE TABLE IF NOT EXISTS route_retry_funding_steps (
  id TEXT PRIMARY KEY NOT NULL,
  mandate_id TEXT NOT NULL REFERENCES route_payment_mandates(id) ON DELETE RESTRICT,
  route_id TEXT NOT NULL REFERENCES route_plans(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL UNIQUE REFERENCES service_orders(id) ON DELETE RESTRICT,
  trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL, terms_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'reserved',
  retry_operation_id TEXT NOT NULL UNIQUE,
  previous_trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS route_retry_funding_steps_route_idx ON route_retry_funding_steps(route_id);
