CREATE TABLE IF NOT EXISTS buyer_evm_payment_claims (
  intent_id TEXT PRIMARY KEY NOT NULL REFERENCES evm_payment_intents(id) ON DELETE RESTRICT,
  mandate_id TEXT NOT NULL REFERENCES route_payment_mandates(id) ON DELETE RESTRICT,
  chain_id INTEGER NOT NULL, payer_address TEXT NOT NULL, nonce INTEGER NOT NULL,
  tx_hash TEXT NOT NULL, terms_hash TEXT NOT NULL, maximum_execution_gas_cost_wei TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'claimed', created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS buyer_evm_payment_claims_wallet_nonce_idx ON buyer_evm_payment_claims(chain_id, payer_address, nonce);
CREATE UNIQUE INDEX IF NOT EXISTS buyer_evm_payment_claims_active_wallet_idx ON buyer_evm_payment_claims(chain_id, payer_address) WHERE state = 'claimed';
