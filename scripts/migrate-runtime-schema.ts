import 'dotenv/config'
import { createClient, type Client } from '@libsql/client'

const RUNTIME_SCHEMA_MIGRATION_ID = '2026-09-13-runtime-schema-v1'
const READINESS_GAPS_MIGRATION_ID = '2026-09-13-readiness-gaps-v2'
const MARKETPLACE_SCALE_MIGRATION_ID = '2026-09-13-marketplace-scale-v1'
const SCHEMA_RECONCILIATION_MIGRATION_ID = '2026-09-14-schema-reconciliation-v1'
const AGENT_DISCOVERY_COLUMNS_MIGRATION_ID = '2026-09-14-agent-discovery-columns-v1'
const WALLET_AUTH_NONCES_MIGRATION_ID = '2026-09-15-wallet-auth-nonces-v1'

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
    mpp_endpoint: 'TEXT',
    llms_txt_url: 'TEXT',
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

async function addWalletAuthNonces(client: Client) {
  await client.execute(`CREATE TABLE IF NOT EXISTS wallet_auth_nonces (
    nonce_hash TEXT PRIMARY KEY NOT NULL,
    address TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    domain TEXT NOT NULL,
    uri TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER
  )`)
  await client.execute('CREATE INDEX IF NOT EXISTS wallet_auth_nonces_expiry_idx ON wallet_auth_nonces(expires_at)')
  await client.execute('CREATE INDEX IF NOT EXISTS wallet_auth_nonces_address_issued_idx ON wallet_auth_nonces(address, issued_at)')
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
      // Re-run the idempotent reconciler under a new immutable ID. Production
      // databases may have recorded an earlier migration before all agent
      // registration columns were part of its implementation.
      { id: SCHEMA_RECONCILIATION_MIGRATION_ID, run: runMigration },
      { id: AGENT_DISCOVERY_COLUMNS_MIGRATION_ID, run: runMigration },
      { id: WALLET_AUTH_NONCES_MIGRATION_ID, run: addWalletAuthNonces },
      { id: '2026-09-16-evm-payment-intents-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS evm_payment_intents (
          id TEXT PRIMARY KEY NOT NULL, trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE CASCADE,
          buyer_id TEXT NOT NULL, origin TEXT NOT NULL, payer_address TEXT NOT NULL, chain_id INTEGER NOT NULL,
          token_address TEXT NOT NULL, treasury_address TEXT NOT NULL, token_amount TEXT NOT NULL,
          token_decimals INTEGER NOT NULL, token_symbol TEXT NOT NULL, token_usd_price REAL NOT NULL,
          amount_usd REAL NOT NULL, expires_at TEXT NOT NULL, created_at INTEGER NOT NULL,
          tx_hash TEXT, payer_signature TEXT
        )`)
      } },
      { id: '2026-09-17-payment-controls-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS payment_controls (
          key TEXT PRIMARY KEY NOT NULL, paused INTEGER NOT NULL DEFAULT 0,
          reason TEXT, updated_by TEXT, updated_at INTEGER NOT NULL
        )`)
        await database.execute(`CREATE TABLE IF NOT EXISTS payment_control_events (
          id TEXT PRIMARY KEY NOT NULL, control_key TEXT NOT NULL, paused INTEGER NOT NULL,
          reason TEXT NOT NULL, actor_user_id TEXT NOT NULL, created_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS payment_control_events_key_created_idx ON payment_control_events(control_key, created_at)')
      } },
      { id: '2026-09-19-webhook-outbox-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id TEXT PRIMARY KEY NOT NULL, webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL, payload TEXT NOT NULL, response_status INTEGER,
          delivered_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, success INTEGER NOT NULL DEFAULT 0
        )`)
        await ensureColumns(database, 'webhook_deliveries', {
          created_at: 'INTEGER',
          next_attempt_at: 'INTEGER',
          locked_at: 'INTEGER',
          last_error: 'TEXT',
        })
        await database.execute('UPDATE webhook_deliveries SET created_at = unixepoch() WHERE created_at IS NULL')
        await database.execute('CREATE INDEX IF NOT EXISTS webhook_deliveries_retry_idx ON webhook_deliveries(success, next_attempt_at)')
      } },
      { id: '2026-09-19-agent-lifecycle-canary-v1', run: async (database: Client) => {
        await ensureColumns(database, 'agents', {
          api_key_prefix: 'TEXT',
          api_key_last_used_at: 'INTEGER',
          api_key_rotated_at: 'INTEGER',
          api_key_revoked_at: 'INTEGER',
          visibility: "TEXT NOT NULL DEFAULT 'public'",
          lifecycle_mode: "TEXT NOT NULL DEFAULT 'persistent'",
          sponsor_agent_id: 'TEXT',
          archived_at: 'INTEGER',
          archive_reason: 'TEXT',
        })
        await database.execute(`CREATE TABLE IF NOT EXISTS agent_lifecycle_events (
          id TEXT PRIMARY KEY NOT NULL, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          action TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT, reason TEXT,
          metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS agents_visibility_status_created_idx ON agents(visibility, status, created_at DESC)')
        await database.execute('CREATE INDEX IF NOT EXISTS agents_lifecycle_archived_idx ON agents(lifecycle_mode, archived_at)')
        await database.execute('CREATE INDEX IF NOT EXISTS agent_lifecycle_events_agent_created_idx ON agent_lifecycle_events(agent_id, created_at DESC)')
      } },
      { id: '2026-09-19-agent-credential-rotation-v1', run: async (database: Client) => {
        await ensureColumns(database, 'agents', {
          previous_api_key: 'TEXT',
          previous_api_key_prefix: 'TEXT',
          previous_api_key_expires_at: 'INTEGER',
        })
        await database.execute('CREATE INDEX IF NOT EXISTS agents_previous_api_key_expiry_idx ON agents(previous_api_key_expires_at)')
      } },
      { id: '2026-09-19-agent-scoped-credentials-ownership-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS agent_credentials (
          id TEXT PRIMARY KEY NOT NULL,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          key_hash TEXT NOT NULL,
          key_prefix TEXT NOT NULL,
          scopes TEXT NOT NULL DEFAULT '[]',
          created_by_type TEXT NOT NULL,
          created_by_id TEXT,
          created_at INTEGER NOT NULL,
          last_used_at INTEGER,
          expires_at INTEGER,
          revoked_at INTEGER,
          revoked_by_type TEXT,
          revoked_by_id TEXT,
          revocation_reason TEXT
        )`)
        await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS agent_credentials_key_hash_idx ON agent_credentials(key_hash)')
        await database.execute('CREATE INDEX IF NOT EXISTS agent_credentials_agent_active_idx ON agent_credentials(agent_id, revoked_at, expires_at)')
        await database.execute(`CREATE TABLE IF NOT EXISTS agent_owners (
          agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          established_by TEXT NOT NULL,
          established_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS agent_owners_user_idx ON agent_owners(user_id)')
        await database.execute(`CREATE TABLE IF NOT EXISTS agent_ownership_transfers (
          id TEXT PRIMARY KEY NOT NULL,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          target_type TEXT NOT NULL,
          target_value TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          accepted_at INTEGER,
          accepted_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
          cancelled_at INTEGER,
          created_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS agent_ownership_transfers_token_hash_idx ON agent_ownership_transfers(token_hash)')
        await database.execute('CREATE INDEX IF NOT EXISTS agent_ownership_transfers_agent_created_idx ON agent_ownership_transfers(agent_id, created_at)')
        await database.execute('CREATE INDEX IF NOT EXISTS agent_ownership_transfers_expiry_idx ON agent_ownership_transfers(expires_at)')
      } },
      { id: '2026-09-20-reference-fleet-execution-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS reference_fleet_controls (
          key TEXT PRIMARY KEY NOT NULL, paused INTEGER NOT NULL DEFAULT 1,
          reason TEXT, updated_by TEXT, updated_at INTEGER NOT NULL
        )`)
        await database.execute(`CREATE TABLE IF NOT EXISTS reference_fleet_control_events (
          id TEXT PRIMARY KEY NOT NULL, control_key TEXT NOT NULL, paused INTEGER NOT NULL,
          reason TEXT NOT NULL, actor_user_id TEXT NOT NULL, created_at INTEGER NOT NULL
        )`)
        await database.execute(`CREATE TABLE IF NOT EXISTS reference_fleet_execution_runs (
          id TEXT PRIMARY KEY NOT NULL, trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE CASCADE,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          state TEXT NOT NULL DEFAULT 'queued', attempt_count INTEGER NOT NULL DEFAULT 0,
          lease_token_hash TEXT, lease_expires_at INTEGER, next_attempt_at INTEGER,
          model_id TEXT, prompt_version TEXT NOT NULL, input_hash TEXT, output_hash TEXT,
          provider_request_id TEXT, input_tokens INTEGER, output_tokens INTEGER,
          web_search_requests INTEGER NOT NULL DEFAULT 0, error_code TEXT, last_error TEXT,
          started_at INTEGER, completed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS reference_fleet_control_events_key_created_idx ON reference_fleet_control_events(control_key, created_at)')
        await database.execute('CREATE INDEX IF NOT EXISTS reference_fleet_execution_queue_idx ON reference_fleet_execution_runs(state, next_attempt_at, created_at)')
        await database.execute('CREATE INDEX IF NOT EXISTS reference_fleet_execution_agent_idx ON reference_fleet_execution_runs(agent_id, created_at)')
      } },
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
