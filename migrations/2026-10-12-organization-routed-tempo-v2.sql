CREATE TABLE IF NOT EXISTS organization_route_tempo_fees (
  authorization_id TEXT PRIMARY KEY NOT NULL REFERENCES organization_route_uses(authorization_id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL,
  chain_id INTEGER NOT NULL CHECK(chain_id = 4217),
  fee_token_address TEXT NOT NULL,
  maximum_fee_token_cost_units TEXT NOT NULL
);
