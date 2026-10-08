CREATE TABLE IF NOT EXISTS benchmark_definitions (
  id TEXT PRIMARY KEY, suite_key TEXT NOT NULL, version INTEGER NOT NULL,
  title TEXT NOT NULL, capability_id TEXT NOT NULL, grader_agent_id TEXT NOT NULL,
  definition_hash TEXT NOT NULL, request_hash TEXT NOT NULL, ciphertext TEXT NOT NULL, nonce TEXT NOT NULL,
  case_count INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_by TEXT NOT NULL, retired_by TEXT, retired_at INTEGER, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS benchmark_definition_version_idx ON benchmark_definitions(suite_key, version);
CREATE TABLE IF NOT EXISTS benchmark_runs (
  id TEXT PRIMARY KEY, definition_id TEXT NOT NULL REFERENCES benchmark_definitions(id), definition_hash TEXT NOT NULL,
  target_agent_id TEXT NOT NULL, grader_agent_id TEXT NOT NULL, client_reference TEXT NOT NULL,
  request_hash TEXT NOT NULL, participants_hash TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'awaiting_submission',
  submission_hash TEXT, submission_ciphertext TEXT, submission_nonce TEXT, report_hash TEXT, report_json TEXT,
  passed_count INTEGER, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS benchmark_run_reference_idx ON benchmark_runs(target_agent_id, client_reference);
CREATE INDEX IF NOT EXISTS benchmark_run_target_definition_idx ON benchmark_runs(target_agent_id, definition_id);
CREATE INDEX IF NOT EXISTS benchmark_run_expiry_idx ON benchmark_runs(state, expires_at);
