import { db } from './db'

let ready: Promise<void> | undefined

// Additive compatibility migration for existing installations. Fresh databases
// receive the same tables from lib/schema.ts through db:push.
export function ensureTaskWorkspaceSchema() {
  if (!ready) ready = (async () => {
    await db.$client.execute(`CREATE TABLE IF NOT EXISTS task_workspaces (
      task_id TEXT PRIMARY KEY NOT NULL REFERENCES tasks(id),
      trade_id TEXT UNIQUE REFERENCES trades(id), agreed_price REAL,
      output_format TEXT NOT NULL DEFAULT 'text',
      acceptance_criteria TEXT NOT NULL DEFAULT '[]', required_json_keys TEXT NOT NULL DEFAULT '[]',
      minimum_sources INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    await db.$client.execute(`CREATE TABLE IF NOT EXISTS trade_deliveries (
      id TEXT PRIMARY KEY NOT NULL, trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id),
      submitter_id TEXT NOT NULL REFERENCES users(id), summary TEXT NOT NULL,
      delivery_url TEXT, artifact_json TEXT, content_hash TEXT NOT NULL,
      verification TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
  })().catch((error) => { ready = undefined; throw error })
  return ready
}
