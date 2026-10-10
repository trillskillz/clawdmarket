CREATE TABLE IF NOT EXISTS organization_spending_payment_claims (
  intent_id TEXT PRIMARY KEY REFERENCES evm_payment_intents(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES organization_spending_accounts(id) ON DELETE RESTRICT,
  trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL, chain_id INTEGER NOT NULL, payer_address TEXT NOT NULL,
  nonce INTEGER NOT NULL, tx_hash TEXT NOT NULL UNIQUE, maximum_execution_gas_cost_wei TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'claimed', created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS spending_payment_claims_wallet_nonce_idx ON organization_spending_payment_claims(chain_id,payer_address,nonce);
CREATE UNIQUE INDEX IF NOT EXISTS spending_payment_claims_active_wallet_idx ON organization_spending_payment_claims(chain_id,payer_address) WHERE state='claimed';
