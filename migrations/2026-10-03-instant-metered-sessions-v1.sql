CREATE TABLE IF NOT EXISTS instant_services (
 id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 title TEXT NOT NULL, capabilities TEXT NOT NULL, input_schema TEXT NOT NULL, output_schema TEXT NOT NULL,
 unit_price_minor INTEGER NOT NULL, max_concurrency INTEGER NOT NULL, deadline_seconds INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')), created_at INTEGER NOT NULL,
 CHECK(unit_price_minor BETWEEN 1 AND 100 AND max_concurrency BETWEEN 1 AND 100 AND deadline_seconds BETWEEN 1 AND 60));
CREATE TABLE IF NOT EXISTS instant_sessions (
 id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 service_id TEXT NOT NULL REFERENCES instant_services(id) ON DELETE RESTRICT,
 client_reference TEXT NOT NULL, contract_json TEXT NOT NULL,
 budget_minor INTEGER NOT NULL, balance_minor INTEGER NOT NULL, held_minor INTEGER NOT NULL DEFAULT 0,
 spent_minor INTEGER NOT NULL DEFAULT 0, refunded_minor INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closing','closed')),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, closed_at INTEGER,
 CHECK(budget_minor BETWEEN 1 AND 10000 AND balance_minor >= 0 AND held_minor >= 0 AND held_minor <= balance_minor
 AND spent_minor >= 0 AND refunded_minor >= 0 AND budget_minor = balance_minor + spent_minor + refunded_minor));
CREATE UNIQUE INDEX IF NOT EXISTS instant_session_reference ON instant_sessions(buyer_id, client_reference);
CREATE INDEX IF NOT EXISTS instant_session_expiry ON instant_sessions(status, expires_at);
CREATE TABLE IF NOT EXISTS instant_calls (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES instant_sessions(id) ON DELETE RESTRICT,
 service_id TEXT NOT NULL REFERENCES instant_services(id) ON DELETE RESTRICT,
 seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 client_reference TEXT NOT NULL, input_json TEXT NOT NULL, input_hash TEXT NOT NULL, unit_price_minor INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','completed','failed')),
 lease_token_hash TEXT, output_json TEXT, receipt_json TEXT, failure_code TEXT,
 created_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL, completed_at INTEGER,
 CHECK((state = 'completed' AND receipt_json IS NOT NULL AND output_json IS NOT NULL)
 OR (state != 'completed' AND receipt_json IS NULL AND output_json IS NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS instant_call_reference ON instant_calls(session_id, client_reference);
CREATE INDEX IF NOT EXISTS instant_call_worker ON instant_calls(seller_id, state, deadline_at);
CREATE INDEX IF NOT EXISTS instant_call_capacity ON instant_calls(service_id, state);
