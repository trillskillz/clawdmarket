import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { createClient } from '@libsql/client'

const execFileAsync = promisify(execFile)

test('runtime schema migration upgrades a legacy database and is idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clawdmarket-runtime-migration-'))
  const databasePath = join(directory, 'legacy.db')
  const databaseUrl = `file:${databasePath}`
  const client = createClient({ url: databaseUrl })

  try {
    for (const statement of [
      'CREATE TABLE users (id TEXT PRIMARY KEY)',
      'CREATE TABLE agents (id TEXT PRIMARY KEY, owner_address TEXT NOT NULL, created_at INTEGER NOT NULL)',
      'CREATE TABLE trades (id TEXT PRIMARY KEY)',
      'CREATE TABLE payment_receipts (id TEXT PRIMARY KEY)',
      'CREATE TABLE bids (id TEXT PRIMARY KEY)',
      'CREATE TABLE webhooks (id TEXT PRIMARY KEY, url TEXT NOT NULL, events TEXT NOT NULL, created_at TEXT NOT NULL)',
      "INSERT INTO webhooks (id, url, events, created_at) VALUES ('legacy-webhook', 'https://example.com/hook', '[]', datetime('now'))",
    ]) await client.execute(statement)
    client.close()

    const environment = { ...process.env, TURSO_DATABASE_URL: databaseUrl }
    const first = await execFileAsync(process.execPath, ['--import', 'tsx', 'scripts/migrate-runtime-schema.ts'], {
      cwd: process.cwd(),
      env: environment,
    })
    const second = await execFileAsync(process.execPath, ['--import', 'tsx', 'scripts/migrate-runtime-schema.ts'], {
      cwd: process.cwd(),
      env: environment,
    })

    assert.match(first.stdout, /Migration applied/)
    assert.match(second.stdout, /Migration already applied/)

    const migrated = createClient({ url: databaseUrl })
    try {
      const users = await migrated.execute('PRAGMA table_info("users")')
      const agents = await migrated.execute('PRAGMA table_info("agents")')
      const trades = await migrated.execute('PRAGMA table_info("trades")')
      const bids = await migrated.execute('PRAGMA table_info("bids")')
      const receipts = await migrated.execute('PRAGMA table_info("payment_receipts")')
      const webhooks = await migrated.execute('PRAGMA table_info("webhooks")')
      const legacyWebhook = await migrated.execute("SELECT active, secret_hash FROM webhooks WHERE id = 'legacy-webhook'")
      const tables = await migrated.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
      const migrationRows = await migrated.execute('SELECT id FROM _clawdmarket_migrations')

      const names = (rows: typeof users.rows) => new Set(rows.map((row) => String(row.name)))
      const tableNames = names(tables.rows)
      assert.equal(names(users.rows).has('avatar_url'), true)
      assert.equal(names(agents.rows).has('claim_code'), true)
      assert.equal(names(agents.rows).has('mpp_endpoint'), true)
      assert.equal(names(agents.rows).has('llms_txt_url'), true)
      assert.equal(names(trades.rows).has('payment_rail'), true)
      assert.equal(names(bids.rows).has('counter_offer_status'), true)
      assert.equal(names(receipts.rows).has('currency'), true)
      assert.equal(names(webhooks.rows).has('secret_hash'), true)
      assert.equal(Number(legacyWebhook.rows[0].active), 0)
      assert.equal(legacyWebhook.rows[0].secret_hash, null)
      assert.equal(tableNames.has('contracts'), true)
      assert.equal(tableNames.has('capability_challenges'), true)
      assert.equal(tableNames.has('agent_usage_events'), true)
      assert.equal(tableNames.has('password_reset_tokens'), true)
      assert.equal(tableNames.has('rate_limits'), true)
      assert.equal(tableNames.has('wallet_auth_nonces'), true)
      assert.equal(tableNames.has('evm_payment_intents'), true)
      assert.equal(tableNames.has('payment_controls'), true)
      assert.equal(tableNames.has('payment_control_events'), true)
      const intents = await migrated.execute('PRAGMA table_info("evm_payment_intents")')
      assert.equal(names(intents.rows).has('payer_signature'), true)
      const webhookDeliveries = await migrated.execute('PRAGMA table_info("webhook_deliveries")')
      assert.equal(names(webhookDeliveries.rows).has('next_attempt_at'), true)
      assert.equal(names(webhookDeliveries.rows).has('last_error'), true)
      assert.equal(migrationRows.rows.length, 9)
    } finally {
      migrated.close()
    }
  } finally {
    client.close()
    await rm(directory, { recursive: true, force: true })
  }
})
