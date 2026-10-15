-- Original listing identities only. This migration grants no checkout or payment authority.
CREATE TABLE IF NOT EXISTS organization_listing_uses (
  authorization_id TEXT PRIMARY KEY NOT NULL REFERENCES organization_listing_authorizations(id) ON DELETE RESTRICT,
  listing_id TEXT NOT NULL UNIQUE REFERENCES listings(id) ON DELETE RESTRICT,
  trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL, client_reference TEXT NOT NULL, request_hash TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  chain_id INTEGER NOT NULL, fee_token_address TEXT, fee_token_decimals INTEGER NOT NULL,
  maximum_chain_fee_units TEXT NOT NULL, created_at INTEGER NOT NULL
);
