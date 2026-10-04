CREATE TABLE IF NOT EXISTS route_controls (
  key TEXT PRIMARY KEY NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1)),
  reason_code TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_checked_at INTEGER,
  healthy_since_at INTEGER, healthy_sampled_at INTEGER,
  healthy_check_count INTEGER NOT NULL DEFAULT 0 CHECK (healthy_check_count >= 0),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS route_control_events (
  id TEXT PRIMARY KEY NOT NULL,
  control_key TEXT NOT NULL REFERENCES route_controls(key) ON DELETE RESTRICT,
  paused INTEGER NOT NULL CHECK (paused IN (0,1)),
  reason_code TEXT NOT NULL,
  revision INTEGER NOT NULL,
  actor_user_id TEXT,
  created_at INTEGER NOT NULL
);
