-- Named scoped credentials and explicit human ownership/recovery records.
CREATE TABLE agent_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  created_by_type TEXT NOT NULL,
  created_by_id TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at INTEGER,
  revoked_at INTEGER,
  revoked_by_type TEXT,
  revoked_by_id TEXT,
  revocation_reason TEXT
);

CREATE UNIQUE INDEX agent_credentials_key_hash_idx ON agent_credentials(key_hash);
CREATE INDEX agent_credentials_agent_active_idx ON agent_credentials(agent_id, revoked_at, expires_at);

CREATE TABLE agent_owners (
  agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  established_by TEXT NOT NULL,
  established_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX agent_owners_user_idx ON agent_owners(user_id);

CREATE TABLE agent_ownership_transfers (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_type TEXT NOT NULL,
  target_value TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  accepted_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX agent_ownership_transfers_token_hash_idx ON agent_ownership_transfers(token_hash);
CREATE INDEX agent_ownership_transfers_agent_created_idx ON agent_ownership_transfers(agent_id, created_at);
CREATE INDEX agent_ownership_transfers_expiry_idx ON agent_ownership_transfers(expires_at);
