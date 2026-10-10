CREATE TABLE IF NOT EXISTS organization_spending_mpp_intents (
  id TEXT PRIMARY KEY, trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, buyer_operation_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES organization_spending_accounts(id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL, origin TEXT NOT NULL, chain_id INTEGER NOT NULL,
  payer_address TEXT NOT NULL, token_address TEXT NOT NULL, treasury_address TEXT NOT NULL,
  token_amount TEXT NOT NULL, token_decimals INTEGER NOT NULL, amount_usd REAL NOT NULL,
  challenge_json TEXT NOT NULL, expires_at TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_spending_mpp_claims (
  intent_id TEXT PRIMARY KEY REFERENCES organization_spending_mpp_intents(id) ON DELETE RESTRICT,
  trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES organization_spending_accounts(id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL, chain_id INTEGER NOT NULL, payer_address TEXT NOT NULL,
  nonce INTEGER NOT NULL, tx_hash TEXT NOT NULL UNIQUE, fee_token_address TEXT NOT NULL,
  maximum_fee_token_cost_units TEXT NOT NULL, valid_before INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'claimed', first_submission_at INTEGER, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS spending_mpp_claims_wallet_nonce_idx ON organization_spending_mpp_claims(chain_id,payer_address,nonce);
CREATE UNIQUE INDEX IF NOT EXISTS spending_mpp_claims_active_wallet_idx ON organization_spending_mpp_claims(chain_id,payer_address) WHERE state='claimed';
