-- Additive authority for original accepted task trades. No legacy work gains permission.
CREATE TABLE IF NOT EXISTS organization_task_authorizations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  winning_bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE RESTRICT,
  poster_id TEXT NOT NULL,
  owner_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  team_id TEXT REFERENCES organization_teams(id) ON DELETE RESTRICT,
  cost_center TEXT NOT NULL,
  reviewer_role_id TEXT NOT NULL REFERENCES organization_purchasing_roles(id) ON DELETE RESTRICT,
  reviewer_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL, request_hash TEXT NOT NULL, authority_hash TEXT NOT NULL,
  terms_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
  decision_reference TEXT, decision_hash TEXT,
  created_at INTEGER NOT NULL, approved_at INTEGER, revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_task_org_reference_idx
  ON organization_task_authorizations(organization_id, client_reference);
CREATE UNIQUE INDEX IF NOT EXISTS organization_task_active_scope_idx
  ON organization_task_authorizations(task_id) WHERE state IN ('pending','approved');

CREATE TABLE IF NOT EXISTS organization_task_uses (
  authorization_id TEXT PRIMARY KEY NOT NULL REFERENCES organization_task_authorizations(id) ON DELETE RESTRICT,
  task_id TEXT NOT NULL UNIQUE REFERENCES task_workspaces(task_id) ON DELETE RESTRICT,
  trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  winning_bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL, client_reference TEXT NOT NULL, request_hash TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  chain_id INTEGER NOT NULL, fee_token_address TEXT, fee_token_decimals INTEGER NOT NULL,
  maximum_chain_fee_units TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_task_payment_claims (
  intent_id TEXT PRIMARY KEY NOT NULL REFERENCES evm_payment_intents(id) ON DELETE RESTRICT,
  authorization_id TEXT NOT NULL REFERENCES organization_task_authorizations(id) ON DELETE RESTRICT,
  trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL, chain_id INTEGER NOT NULL, payer_address TEXT NOT NULL,
  nonce INTEGER NOT NULL, tx_hash TEXT NOT NULL UNIQUE, maximum_execution_gas_cost_wei TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'claimed', created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS task_payment_claims_wallet_nonce_idx
  ON organization_task_payment_claims(chain_id, payer_address, nonce);
CREATE UNIQUE INDEX IF NOT EXISTS task_payment_claims_active_wallet_idx
  ON organization_task_payment_claims(chain_id, payer_address) WHERE state='claimed';
CREATE TABLE IF NOT EXISTS organization_task_mpp_intents (
  id TEXT PRIMARY KEY NOT NULL, trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, buyer_operation_id TEXT NOT NULL UNIQUE,
  authorization_id TEXT NOT NULL REFERENCES organization_task_authorizations(id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL, origin TEXT NOT NULL, chain_id INTEGER NOT NULL,
  payer_address TEXT NOT NULL, token_address TEXT NOT NULL, treasury_address TEXT NOT NULL,
  token_amount TEXT NOT NULL, token_decimals INTEGER NOT NULL, amount_usd REAL NOT NULL,
  challenge_json TEXT NOT NULL, expires_at TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_task_mpp_claims (
  intent_id TEXT PRIMARY KEY NOT NULL REFERENCES organization_task_mpp_intents(id) ON DELETE RESTRICT,
  trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  authorization_id TEXT NOT NULL REFERENCES organization_task_authorizations(id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL, chain_id INTEGER NOT NULL, payer_address TEXT NOT NULL,
  nonce INTEGER NOT NULL, tx_hash TEXT NOT NULL UNIQUE, fee_token_address TEXT NOT NULL,
  maximum_fee_token_cost_units TEXT NOT NULL, valid_before INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'claimed', first_submission_at INTEGER, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS task_mpp_claims_wallet_nonce_idx
  ON organization_task_mpp_claims(chain_id, payer_address, nonce);
CREATE UNIQUE INDEX IF NOT EXISTS task_mpp_claims_active_wallet_idx
  ON organization_task_mpp_claims(chain_id, payer_address) WHERE state='claimed';
