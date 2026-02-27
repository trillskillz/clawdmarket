-- Agent environment hardening
-- Adds session immutability, replay-protection nonces, and event sequencing ledger

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  declared_params TEXT NOT NULL,
  declared_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_instruction_nonces (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_stream (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  sequence_id INTEGER NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_status ON agent_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_expires_at ON agent_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_nonces_user_created ON agent_instruction_nonces(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_event_stream_user_sequence ON event_stream(user_id, sequence_id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_stream_user_sequence ON event_stream(user_id, sequence_id);
