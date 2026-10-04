CREATE TABLE IF NOT EXISTS buyer_mpp_payment_intents (
  id TEXT PRIMARY KEY NOT NULL, trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, buyer_operation_id TEXT NOT NULL UNIQUE,
  mandate_id TEXT NOT NULL REFERENCES route_payment_mandates(id) ON DELETE RESTRICT,
  origin TEXT NOT NULL, terms_hash TEXT NOT NULL, chain_id INTEGER NOT NULL, payer_address TEXT NOT NULL,
  token_address TEXT NOT NULL, treasury_address TEXT NOT NULL, token_amount TEXT NOT NULL,
  token_decimals INTEGER NOT NULL, amount_usd REAL NOT NULL, challenge_json TEXT NOT NULL,
  expires_at TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS buyer_mpp_payment_claims (
  intent_id TEXT PRIMARY KEY NOT NULL REFERENCES buyer_mpp_payment_intents(id) ON DELETE RESTRICT,
  mandate_id TEXT NOT NULL REFERENCES route_payment_mandates(id) ON DELETE RESTRICT,
  chain_id INTEGER NOT NULL, payer_address TEXT NOT NULL, nonce INTEGER NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE, terms_hash TEXT NOT NULL, fee_token_address TEXT NOT NULL,
  maximum_fee_token_cost_units TEXT NOT NULL, valid_before INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'claimed', first_submission_at INTEGER, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS buyer_mpp_payment_claims_wallet_nonce_idx ON buyer_mpp_payment_claims(chain_id, payer_address, nonce);
CREATE UNIQUE INDEX IF NOT EXISTS buyer_mpp_payment_claims_active_wallet_idx ON buyer_mpp_payment_claims(chain_id, payer_address) WHERE state = 'claimed';
