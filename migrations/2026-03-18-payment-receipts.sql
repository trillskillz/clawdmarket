CREATE TABLE IF NOT EXISTS payment_receipts (
  id text PRIMARY KEY NOT NULL,
  route text NOT NULL,
  amount real NOT NULL,
  currency text NOT NULL,
  tx_hash text,
  payer_address text,
  created_at integer NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_route_created_at
  ON payment_receipts(route, created_at DESC);
