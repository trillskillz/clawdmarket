CREATE TABLE IF NOT EXISTS mcp_route_tasks (
 id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
 context_id TEXT NOT NULL, first_message_id TEXT NOT NULL, initial_message TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('route_work','cancel_route')),
 route_id TEXT REFERENCES route_plans(id) ON DELETE RESTRICT,
 mandate_id TEXT REFERENCES route_payment_mandates(id) ON DELETE RESTRICT,
 last_error_code TEXT, terminal_status TEXT CHECK(terminal_status IN ('completed','failed','cancelled')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_route_first_message ON mcp_route_tasks(agent_id, first_message_id);
CREATE INDEX IF NOT EXISTS mcp_route_agent_created ON mcp_route_tasks(agent_id, created_at);
CREATE TABLE IF NOT EXISTS mcp_result_streams (
 id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
 task_id TEXT NOT NULL REFERENCES mcp_route_tasks(id) ON DELETE RESTRICT,
 rpc_id_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mcp_result_stream_agent_expiry ON mcp_result_streams(agent_id, expires_at);
