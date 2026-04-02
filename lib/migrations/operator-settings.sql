CREATE TABLE IF NOT EXISTS operator_settings (
  agent_id TEXT PRIMARY KEY,
  daily_spend_cap REAL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
