-- Additive metadata only. Original creation time anchors legacy acceptance deadlines.
ALTER TABLE service_execution_attempts ADD COLUMN acknowledgment_due_at INTEGER;
UPDATE service_execution_attempts SET acknowledgment_due_at = created_at + 600 WHERE acknowledgment_due_at IS NULL;
CREATE INDEX IF NOT EXISTS service_execution_attempts_state_ack_idx ON service_execution_attempts(state, acknowledgment_due_at);
