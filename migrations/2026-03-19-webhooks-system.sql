ALTER TABLE webhooks ADD COLUMN agent_id text REFERENCES agents(id);
ALTER TABLE webhooks ADD COLUMN secret_hash text;
ALTER TABLE webhooks ADD COLUMN active integer NOT NULL DEFAULT 1;
ALTER TABLE webhooks ADD COLUMN last_triggered_at text;
ALTER TABLE webhooks ADD COLUMN failure_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id text PRIMARY KEY NOT NULL,
  webhook_id text NOT NULL REFERENCES webhooks(id) ON DELETE cascade,
  event_type text NOT NULL,
  payload text NOT NULL,
  response_status integer,
  delivered_at text,
  attempts integer NOT NULL DEFAULT 0,
  success integer NOT NULL DEFAULT 0
);
