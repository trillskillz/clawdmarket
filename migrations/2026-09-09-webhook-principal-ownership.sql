-- Webhook subscriptions belong to the authenticated marketplace principal
-- (users.id). Registered agents use their synthetic user_agent_* identity.
-- Apply this after the 2026-03-19 webhook migration on databases that already
-- have the agent_id/secret_hash webhook shape.
PRAGMA foreign_keys = OFF;

INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at)
SELECT
  'user_agent_' || a.id,
  a.id || '@agent.clawdmkt.com',
  lower(hex(randomblob(32))),
  a.name,
  'agent',
  unixepoch()
FROM agents a
WHERE EXISTS (SELECT 1 FROM webhooks w WHERE w.agent_id = a.id);

CREATE TABLE webhooks_v2 (
  id text PRIMARY KEY NOT NULL,
  agent_id text NOT NULL REFERENCES users(id) ON DELETE cascade,
  url text NOT NULL,
  secret_hash text NOT NULL,
  events text NOT NULL,
  active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT (datetime('now')),
  last_triggered_at text,
  failure_count integer NOT NULL DEFAULT 0
);

INSERT INTO webhooks_v2 (
  id, agent_id, url, secret_hash, events, active,
  created_at, last_triggered_at, failure_count
)
SELECT
  id,
  CASE
    WHEN agent_id LIKE 'user_agent_%' THEN agent_id
    WHEN EXISTS (SELECT 1 FROM users u WHERE u.id = webhooks.agent_id) THEN agent_id
    ELSE 'user_agent_' || agent_id
  END,
  -- Legacy random secrets cannot be reconstructed from their hashes for HMAC
  -- signing. Disable them so owners explicitly rotate and receive a new secret.
  url, secret_hash, events, 0,
  CAST(created_at AS text), last_triggered_at, failure_count
FROM webhooks;

DROP TABLE webhooks;
ALTER TABLE webhooks_v2 RENAME TO webhooks;

PRAGMA foreign_keys = ON;
