-- Add channel tracking columns for MPP session settlement lifecycle.
ALTER TABLE mpp_sessions ADD COLUMN channel_id text;
ALTER TABLE mpp_sessions ADD COLUMN close_tx_hash text;
