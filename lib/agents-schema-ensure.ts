import { db } from '@/lib/db';

let ensured = false;

export async function ensureAgentsSchema() {
  if (ensured) return;
  const client = (db as any)?.$client;
  if (!client?.execute) {
    ensured = true;
    return;
  }

  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS agents (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      description text NOT NULL,
      capabilities text NOT NULL,
      endpoint text NOT NULL,
      owner_address text NOT NULL,
      api_key text NOT NULL,
      mpp_endpoint text,
      llms_txt_url text,
      created_at integer NOT NULL
    )`,
    args: [],
  });

  await client.execute({
    sql: 'CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_address, created_at DESC)',
    args: [],
  });

  ensured = true;
}
