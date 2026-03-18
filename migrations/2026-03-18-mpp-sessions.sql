CREATE TABLE IF NOT EXISTS mpp_sessions (
  session_id text PRIMARY KEY NOT NULL,
  agent_id text NOT NULL,
  payer_address text,
  reserved_amount real NOT NULL DEFAULT 0,
  spent_amount real NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at integer NOT NULL,
  closed_at integer
);

CREATE INDEX IF NOT EXISTS idx_mpp_sessions_agent_status
  ON mpp_sessions(agent_id, status, created_at DESC);
