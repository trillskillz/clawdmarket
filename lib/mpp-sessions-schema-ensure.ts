import { db } from '@/lib/db';

let ensured = false;

export async function ensureMppSessionsSchema() {
  if (ensured) return;

  const client = (db as any)?.$client;
  if (!client?.execute) {
    ensured = true;
    return;
  }

  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS mpp_sessions (
      session_id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL,
      payer_address text,
      reserved_amount real NOT NULL DEFAULT 0,
      spent_amount real NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'active',
      created_at integer NOT NULL,
      closed_at integer,
      channel_id text,
      close_tx_hash text
    )`,
    args: [],
  });

  await client.execute({
    sql: 'CREATE INDEX IF NOT EXISTS idx_mpp_sessions_agent_status ON mpp_sessions(agent_id, status, created_at DESC)',
    args: [],
  });

  ensured = true;
}
