-- Separate original listing EVM/Tempo claims; existing task/route/spending scopes retain their identities.
CREATE TABLE IF NOT EXISTS organization_listing_payment_claims (
  intent_id TEXT PRIMARY KEY NOT NULL REFERENCES evm_payment_intents(id) ON DELETE RESTRICT,
  authorization_id TEXT NOT NULL REFERENCES organization_listing_authorizations(id) ON DELETE RESTRICT,
  trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL, chain_id INTEGER NOT NULL, payer_address TEXT NOT NULL,
  nonce INTEGER NOT NULL, tx_hash TEXT NOT NULL UNIQUE, maximum_execution_gas_cost_wei TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'claimed', created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS listing_payment_claims_wallet_nonce_idx
  ON organization_listing_payment_claims(chain_id, payer_address, nonce);
CREATE UNIQUE INDEX IF NOT EXISTS listing_payment_claims_active_wallet_idx
  ON organization_listing_payment_claims(chain_id, payer_address) WHERE state='claimed';
CREATE TABLE IF NOT EXISTS organization_listing_mpp_intents (
  id TEXT PRIMARY KEY NOT NULL, trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, buyer_operation_id TEXT NOT NULL UNIQUE,
  authorization_id TEXT NOT NULL REFERENCES organization_listing_authorizations(id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL, origin TEXT NOT NULL, chain_id INTEGER NOT NULL,
  payer_address TEXT NOT NULL, token_address TEXT NOT NULL, treasury_address TEXT NOT NULL,
  token_amount TEXT NOT NULL, token_decimals INTEGER NOT NULL, amount_usd REAL NOT NULL,
  challenge_json TEXT NOT NULL, expires_at TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_listing_mpp_claims (
  intent_id TEXT PRIMARY KEY NOT NULL REFERENCES organization_listing_mpp_intents(id) ON DELETE RESTRICT,
  trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  authorization_id TEXT NOT NULL REFERENCES organization_listing_authorizations(id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL, chain_id INTEGER NOT NULL, payer_address TEXT NOT NULL,
  nonce INTEGER NOT NULL, tx_hash TEXT NOT NULL UNIQUE, fee_token_address TEXT NOT NULL,
  maximum_fee_token_cost_units TEXT NOT NULL, valid_before INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'claimed', first_submission_at INTEGER, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS listing_mpp_claims_wallet_nonce_idx
  ON organization_listing_mpp_claims(chain_id, payer_address, nonce);
CREATE UNIQUE INDEX IF NOT EXISTS listing_mpp_claims_active_wallet_idx
  ON organization_listing_mpp_claims(chain_id, payer_address) WHERE state='claimed';
