ALTER TABLE agents ADD COLUMN api_key_prefix TEXT;
ALTER TABLE agents ADD COLUMN api_key_last_used_at INTEGER;
ALTER TABLE agents ADD COLUMN api_key_rotated_at INTEGER;
ALTER TABLE agents ADD COLUMN api_key_revoked_at INTEGER;
ALTER TABLE agents ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE agents ADD COLUMN lifecycle_mode TEXT NOT NULL DEFAULT 'persistent';
ALTER TABLE agents ADD COLUMN sponsor_agent_id TEXT;
ALTER TABLE agents ADD COLUMN archived_at INTEGER;
ALTER TABLE agents ADD COLUMN archive_reason TEXT;

CREATE INDEX IF NOT EXISTS agents_visibility_status_created_idx
  ON agents(visibility, status, created_at DESC);
CREATE INDEX IF NOT EXISTS agents_lifecycle_archived_idx
  ON agents(lifecycle_mode, archived_at);

CREATE TABLE IF NOT EXISTS agent_lifecycle_events (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  reason TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_lifecycle_events_agent_created_idx
  ON agent_lifecycle_events(agent_id, created_at DESC);
