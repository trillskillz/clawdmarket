CREATE TABLE IF NOT EXISTS verification_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  verifier_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  artifact_id TEXT NOT NULL REFERENCES private_artifacts(id) ON DELETE RESTRICT,
  artifact_sha256 TEXT NOT NULL, client_reference TEXT NOT NULL, request_hash TEXT NOT NULL,
  policy_json TEXT NOT NULL, suite_ciphertext TEXT, suite_nonce TEXT, case_count INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', report_json TEXT, report_hash TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS verification_jobs_trade_reference_idx ON verification_jobs(trade_id, client_reference);
CREATE INDEX IF NOT EXISTS verification_jobs_verifier_state_idx ON verification_jobs(verifier_agent_id, state, expires_at);
