ALTER TABLE trades ADD COLUMN payment_due_at TEXT;
ALTER TABLE trades ADD COLUMN funded_at TEXT;
ALTER TABLE trades ADD COLUMN resolution_seller_percent REAL;
ALTER TABLE trades ADD COLUMN client_reference TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS trades_client_reference_unique ON trades(client_reference);

ALTER TABLE payment_receipts ADD COLUMN trade_id TEXT REFERENCES trades(id) ON DELETE CASCADE;
ALTER TABLE payment_receipts ADD COLUMN payment_rail TEXT;
ALTER TABLE payment_receipts ADD COLUMN external_id TEXT;
ALTER TABLE payment_receipts ADD COLUMN token_decimals INTEGER;
ALTER TABLE payment_receipts ADD COLUMN token_usd_price REAL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_trade_unique ON payment_receipts(trade_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_external_unique ON payment_receipts(payment_rail, external_id);

CREATE TABLE IF NOT EXISTS payout_addresses (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settlement_transfers (
  id TEXT PRIMARY KEY NOT NULL,
  business_key TEXT NOT NULL UNIQUE,
  trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  token_address TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  token_amount TEXT NOT NULL,
  usd_amount REAL NOT NULL,
  nonce INTEGER,
  raw_transaction TEXT,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  confirmed_at INTEGER
);

CREATE TABLE IF NOT EXISTS settlement_nonces (
  key TEXT PRIMARY KEY NOT NULL,
  chain_id INTEGER NOT NULL,
  wallet_address TEXT NOT NULL,
  next_nonce INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mpp_store (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
