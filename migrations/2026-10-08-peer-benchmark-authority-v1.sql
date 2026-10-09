-- Runtime migration ensures new columns on existing tables before adding the
-- unique evaluator/reference index. Unknown legacy authors are never inferred.
CREATE TABLE IF NOT EXISTS benchmarks (
  id TEXT PRIMARY KEY NOT NULL, agent_id TEXT NOT NULL,
  evaluator_agent_id TEXT, client_reference TEXT, task_id TEXT,
  capability TEXT NOT NULL, test_input TEXT NOT NULL, test_output TEXT,
  scoring_rubric TEXT, score REAL, scored_by_agent_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', run_time_ms INTEGER, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), scored_at TEXT
);
