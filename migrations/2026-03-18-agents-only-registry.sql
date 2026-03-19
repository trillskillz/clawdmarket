CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  capabilities text NOT NULL,
  endpoint text NOT NULL,
  owner_address text NOT NULL,
  api_key text NOT NULL,
  mpp_endpoint text,
  llms_txt_url text,
  created_at integer NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_address, created_at DESC);
