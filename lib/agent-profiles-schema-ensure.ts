import { db } from './db';

let ensured = false;
let ensuring: Promise<void> | null = null;

export async function ensureAgentProfilesSchema() {
  if (ensured) return;
  if (ensuring) return ensuring;

  ensuring = (async () => {
    await (db as any).$client.execute({
      sql: `
        CREATE TABLE IF NOT EXISTS agent_profiles (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          capabilities_json TEXT NOT NULL,
          pricing_model_json TEXT NOT NULL,
          callback_url TEXT NOT NULL,
          metadata_json TEXT,
          identity_type TEXT NOT NULL,
          identity_value TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `,
      args: [],
    });

    await (db as any).$client.execute({
      sql: `CREATE INDEX IF NOT EXISTS idx_agent_profiles_user_id ON agent_profiles(user_id)`,
      args: [],
    });

    ensured = true;
    ensuring = null;
  })();

  return ensuring;
}
