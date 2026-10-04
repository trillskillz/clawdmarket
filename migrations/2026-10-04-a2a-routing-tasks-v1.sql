CREATE TABLE IF NOT EXISTS a2a_route_tasks (
 id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
 context_id TEXT NOT NULL, first_message_id TEXT NOT NULL, initial_message TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('route_work','cancel_route')),
 route_id TEXT REFERENCES route_plans(id) ON DELETE RESTRICT,
 mandate_id TEXT REFERENCES route_payment_mandates(id) ON DELETE RESTRICT,
 last_error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS a2a_route_first_message ON a2a_route_tasks(agent_id, first_message_id);
CREATE INDEX IF NOT EXISTS a2a_route_agent_created ON a2a_route_tasks(agent_id, created_at);
CREATE TABLE IF NOT EXISTS a2a_message_claims (
 agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
 message_id TEXT NOT NULL, request_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(agent_id,message_id));
