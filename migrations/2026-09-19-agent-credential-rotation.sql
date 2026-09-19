-- Registered-agent single-key rotation with a bounded no-downtime overlap.
ALTER TABLE agents ADD COLUMN previous_api_key TEXT;
ALTER TABLE agents ADD COLUMN previous_api_key_prefix TEXT;
ALTER TABLE agents ADD COLUMN previous_api_key_expires_at INTEGER;

CREATE INDEX agents_previous_api_key_expiry_idx
  ON agents(previous_api_key_expires_at);
