import 'dotenv/config'
import { createClient, type Client } from '@libsql/client'

const RUNTIME_SCHEMA_MIGRATION_ID = '2026-09-13-runtime-schema-v1'
const READINESS_GAPS_MIGRATION_ID = '2026-09-13-readiness-gaps-v2'
const MARKETPLACE_SCALE_MIGRATION_ID = '2026-09-13-marketplace-scale-v1'

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

async function tableColumns(client: Client, table: string) {
  const result = await client.execute(`PRAGMA table_info(${quoteIdentifier(table)})`)
  if (result.rows.length === 0) throw new Error(`Required base table is missing: ${table}`)
  return new Set(result.rows.map((row) => String((row as Record<string, unknown>).name || '')))
}

async function tableExists(client: Client, table: string) {
  const result = await client.execute({
    sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    args: [table],
  })
  return result.rows.length > 0
}

async function ensureColumns(
  client: Client,
  table: string,
  columns: Record<string, string>,
) {
  const existing = await tableColumns(client, table)
  for (const [name, definition] of Object.entries(columns)) {
    if (existing.has(name)) continue
    await client.execute(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(name)} ${definition}`)
    existing.add(name)
  }
}

async function runMigration(client: Client) {
  await ensureColumns(client, 'users', {
    bio: 'TEXT',
    avatar_url: 'TEXT',
    avatar_emoji: 'TEXT',
    is_banned: 'INTEGER NOT NULL DEFAULT 0',
    updated_at: 'INTEGER',
  })
  await ensureColumns(client, 'agents', {
    owner_email: 'TEXT',
    api_key: 'TEXT',
    status: "TEXT NOT NULL DEFAULT 'active'",
    endpoint_verified_at: 'INTEGER',
    endpoint_failures: 'INTEGER NOT NULL DEFAULT 0',
    avg_rating: 'REAL',
    rating_count: 'INTEGER NOT NULL DEFAULT 0',
    version: 'INTEGER NOT NULL DEFAULT 1',
    base_agent_id: 'TEXT',
    parent_version_id: 'TEXT',
    system_prompt: 'TEXT',
    tools_config: "TEXT NOT NULL DEFAULT '[]'",
    model_id: 'TEXT',
    benchmark_score: 'REAL',
    benchmark_count: 'INTEGER NOT NULL DEFAULT 0',
    benchmark_history: "TEXT NOT NULL DEFAULT '[]'",
    velocity_score: 'REAL',
    last_benchmark_at: 'TEXT',
    improvement_count: 'INTEGER NOT NULL DEFAULT 0',
    total_improvement_delta: 'REAL NOT NULL DEFAULT 0',
    last_improved_at: 'TEXT',
    improved_by_agent_id: 'TEXT',
    claim_code: 'TEXT',
    claimed_at: 'TEXT',
    moltbook_handle: 'TEXT',
    last_seen_at: 'INTEGER',
    is_online: 'INTEGER NOT NULL DEFAULT 0',
  })
  await ensureColumns(client, 'trades', {
    payment_rail: "TEXT NOT NULL DEFAULT 'ledger'",
    client_reference: 'TEXT',
    payment_due_at: 'TEXT',
    funded_at: 'TEXT',
    resolution_seller_percent: 'REAL',
  })
  await ensureColumns(client, 'payment_receipts', {
    trade_id: 'TEXT REFERENCES trades(id) ON DELETE CASCADE',
    payment_rail: 'TEXT',
    external_id: 'TEXT',
    token_address: 'TEXT',
    chain_id: 'INTEGER',
    token_symbol: 'TEXT',
    token_decimals: 'INTEGER',
    token_amount: 'TEXT',
    token_usd_price: 'REAL',
    usd_value_at_payment: 'REAL',
  })
  await ensureColumns(client, 'bids', {
    counter_offer_price: 'REAL',
    counter_offer_message: 'TEXT',
    counter_offer_status: "TEXT NOT NULL DEFAULT 'none'",
  })

  const tableStatements = [
    `CREATE TABLE IF NOT EXISTS task_workspaces (
      task_id TEXT PRIMARY KEY NOT NULL REFERENCES tasks(id), trade_id TEXT UNIQUE REFERENCES trades(id),
      agreed_price REAL, output_format TEXT NOT NULL DEFAULT 'text', acceptance_criteria TEXT NOT NULL DEFAULT '[]',
      required_json_keys TEXT NOT NULL DEFAULT '[]', minimum_sources INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS trade_deliveries (
      id TEXT PRIMARY KEY NOT NULL, trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id),
      submitter_id TEXT NOT NULL REFERENCES users(id), summary TEXT NOT NULL, delivery_url TEXT,
      artifact_json TEXT, content_hash TEXT NOT NULL, verification TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS payout_addresses (
      user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      address TEXT NOT NULL, updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS settlement_transfers (
      id TEXT PRIMARY KEY NOT NULL, business_key TEXT NOT NULL UNIQUE,
      trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE, kind TEXT NOT NULL,
      chain_id INTEGER NOT NULL, token_address TEXT NOT NULL, from_address TEXT NOT NULL,
      to_address TEXT NOT NULL, token_amount TEXT NOT NULL, usd_amount REAL NOT NULL,
      nonce INTEGER, raw_transaction TEXT, tx_hash TEXT, status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, confirmed_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS settlement_nonces (
      key TEXT PRIMARY KEY NOT NULL, chain_id INTEGER NOT NULL, wallet_address TEXT NOT NULL,
      next_nonce INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS mpp_store (
      key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY NOT NULL, buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL, listing_id TEXT,
      total_amount REAL NOT NULL, fee_amount REAL NOT NULL DEFAULT 0, escrow_amount REAL NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'DRAFT', expires_at INTEGER, current_milestone_index INTEGER NOT NULL DEFAULT 0,
      dispute_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS contract_milestones (
      id TEXT PRIMARY KEY NOT NULL, contract_id TEXT NOT NULL, milestone_index INTEGER NOT NULL,
      title TEXT NOT NULL, amount REAL NOT NULL, acceptance_spec TEXT NOT NULL, deadline_at INTEGER,
      review_window_hours INTEGER NOT NULL DEFAULT 24, state TEXT NOT NULL DEFAULT 'PENDING',
      submission_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS contract_submissions (
      id TEXT PRIMARY KEY NOT NULL, milestone_id TEXT NOT NULL, submitted_by TEXT NOT NULL,
      artifact_bundle TEXT NOT NULL, auto_check_result TEXT NOT NULL DEFAULT 'inconclusive',
      auto_check_report TEXT NOT NULL, submitted_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS contract_disputes (
      id TEXT PRIMARY KEY NOT NULL, contract_id TEXT NOT NULL, milestone_id TEXT, raised_by TEXT NOT NULL,
      reason_code TEXT NOT NULL, evidence TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open', ruling TEXT,
      resolved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS agent_usage_events (
      id TEXT PRIMARY KEY NOT NULL, agent_id TEXT NOT NULL, feature TEXT NOT NULL, event_type TEXT NOT NULL,
      route TEXT, payer TEXT, amount_usd REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS user_ips (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, ip TEXT NOT NULL,
      last_seen INTEGER NOT NULL, PRIMARY KEY(user_id, ip)
    )`,
    `CREATE TABLE IF NOT EXISTS blacklisted_ips (
      ip TEXT PRIMARY KEY NOT NULL, reason TEXT, created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS banned_users (
      user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT, created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS capability_challenges (
      id TEXT PRIMARY KEY NOT NULL, agent_id TEXT, capability TEXT NOT NULL, challenge_data TEXT NOT NULL,
      expires_at INTEGER NOT NULL, submitted_at INTEGER, passed INTEGER, score REAL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT, event_type TEXT NOT NULL, metadata TEXT,
      ip_hash TEXT, created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS watchlist (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE, created_at INTEGER NOT NULL
    )`,
  ]
  for (const statement of tableStatements) await client.execute(statement)

  const indexStatements = [
    'CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_address, created_at DESC)',
    'CREATE UNIQUE INDEX IF NOT EXISTS trades_client_reference_unique ON trades(client_reference)',
    'CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_trade_unique ON payment_receipts(trade_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_external_unique ON payment_receipts(payment_rail, external_id)',
    'CREATE INDEX IF NOT EXISTS contracts_buyer_idx ON contracts(buyer_id)',
    'CREATE INDEX IF NOT EXISTS contracts_seller_idx ON contracts(seller_id)',
    'CREATE INDEX IF NOT EXISTS contract_milestones_contract_idx ON contract_milestones(contract_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS contract_milestones_contract_mi_idx ON contract_milestones(contract_id, milestone_index)',
    'CREATE INDEX IF NOT EXISTS contract_submissions_milestone_idx ON contract_submissions(milestone_id)',
    'CREATE INDEX IF NOT EXISTS contract_disputes_contract_idx ON contract_disputes(contract_id)',
    'CREATE INDEX IF NOT EXISTS idx_agent_usage_events_agent_created ON agent_usage_events(agent_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_agent_usage_events_type_created ON agent_usage_events(event_type, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS capability_challenges_agent_created_idx ON capability_challenges(agent_id, created_at)',
    'CREATE INDEX IF NOT EXISTS analytics_events_user_created_idx ON analytics_events(user_id, created_at)',
    'CREATE INDEX IF NOT EXISTS watchlist_user_created_idx ON watchlist(user_id, created_at)',
  ]
  for (const statement of indexStatements) await client.execute(statement)
}

async function closeReadinessGaps(client: Client) {
  await client.execute(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`)
  await client.execute(`CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    reset_at INTEGER NOT NULL
  )`)
  await client.execute(`CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    events TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_triggered_at TEXT,
    failure_count INTEGER NOT NULL DEFAULT 0
  )`)

  await ensureColumns(client, 'payment_receipts', {
    amount: 'REAL NOT NULL DEFAULT 0',
    currency: "TEXT NOT NULL DEFAULT 'USD'",
  })
  await ensureColumns(client, 'webhooks', {
    agent_id: 'TEXT',
    secret_hash: 'TEXT',
    // Legacy subscriptions lack recoverable signing material. Keep them
    // inactive until their owner creates a new signed subscription.
    active: 'INTEGER NOT NULL DEFAULT 0',
    last_triggered_at: 'TEXT',
    failure_count: 'INTEGER NOT NULL DEFAULT 0',
  })

  await client.execute('CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx ON password_reset_tokens(expires_at)')
}

async function addMarketplaceScaleIndexes(client: Client) {
  if (await tableExists(client, 'agents')) {
    await client.execute('CREATE INDEX IF NOT EXISTS agents_status_created_idx ON agents(status, created_at DESC)')
  }
  if (await tableExists(client, 'listings')) {
    await client.execute('CREATE INDEX IF NOT EXISTS listings_status_created_idx ON listings(status, created_at DESC)')
    await client.execute('CREATE INDEX IF NOT EXISTS listings_status_category_created_idx ON listings(status, category, created_at DESC)')
  }
}

async function main() {
  const configuredUrl = process.env.TURSO_DATABASE_URL?.trim()
  if (!configuredUrl && (process.env.CI === 'true' || process.env.VERCEL === '1')) {
    throw new Error('TURSO_DATABASE_URL is required for CI and deployment migrations')
  }
  const url = configuredUrl || 'file:./local.db'
  if (!url.startsWith('file:') && !process.env.TURSO_AUTH_TOKEN?.trim()) {
    throw new Error('TURSO_AUTH_TOKEN is required for a remote database migration')
  }
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
  try {
    await client.execute(`CREATE TABLE IF NOT EXISTS _clawdmarket_migrations (
      id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL
    )`)
    const migrations = [
      { id: RUNTIME_SCHEMA_MIGRATION_ID, run: runMigration },
      { id: READINESS_GAPS_MIGRATION_ID, run: closeReadinessGaps },
      { id: MARKETPLACE_SCALE_MIGRATION_ID, run: addMarketplaceScaleIndexes },
    ]
    for (const migration of migrations) {
      const existing = await client.execute({
        sql: 'SELECT id FROM _clawdmarket_migrations WHERE id = ? LIMIT 1',
        args: [migration.id],
      })
      if (existing.rows.length > 0) {
        console.log(`Migration already applied: ${migration.id}`)
        continue
      }

      await migration.run(client)
      await client.execute({
        sql: 'INSERT INTO _clawdmarket_migrations (id, applied_at) VALUES (?, ?)',
        args: [migration.id, new Date().toISOString()],
      })
      console.log(`Migration applied: ${migration.id}`)
    }
  } finally {
    client.close()
  }
}

main().catch((error) => {
  console.error('Runtime schema migration failed:', error)
  process.exitCode = 1
})
