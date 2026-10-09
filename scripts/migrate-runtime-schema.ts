import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { createClient, type Client } from '@libsql/client'

const RUNTIME_SCHEMA_MIGRATION_ID = '2026-09-13-runtime-schema-v1'
const READINESS_GAPS_MIGRATION_ID = '2026-09-13-readiness-gaps-v2'
const MARKETPLACE_SCALE_MIGRATION_ID = '2026-09-13-marketplace-scale-v1'
const SCHEMA_RECONCILIATION_MIGRATION_ID = '2026-09-14-schema-reconciliation-v1'
const AGENT_DISCOVERY_COLUMNS_MIGRATION_ID = '2026-09-14-agent-discovery-columns-v1'
const WALLET_AUTH_NONCES_MIGRATION_ID = '2026-09-15-wallet-auth-nonces-v1'
const TRADE_CHECKOUT_COLUMNS_MIGRATION_ID = '2026-09-23-trade-checkout-columns-v1'
const PAYMENT_RECEIPT_PAYER_MIGRATION_ID = '2026-09-23-payment-receipt-payer-v1'

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

async function reconcileTradeCheckoutColumns(client: Client) {
  // Older installations passed the former readiness check but lacked columns
  // selected by Drizzle's trade INSERT ... RETURNING during external checkout.
  const definitions = {
    dev_amount: 'REAL NOT NULL DEFAULT 0',
    dev_wallet: 'TEXT',
    fee_tx_hash: 'TEXT',
    escrow_session_id: 'TEXT',
    auto_confirm_at: 'TEXT',
    dispute_reason: 'TEXT',
    resolution: 'TEXT',
    completed_at: 'INTEGER',
    rating_window_expires_at: 'TEXT',
  }
  const before = await tableColumns(client, 'trades')
  console.log('Trade checkout columns missing before reconciliation:', Object.keys(definitions).filter((name) => !before.has(name)).join(', ') || 'none')
  await ensureColumns(client, 'trades', definitions)
}

async function reconcilePaymentReceiptPayer(client: Client) {
  const before = await tableColumns(client, 'payment_receipts')
  console.log('Payment receipt payer column missing before reconciliation:', !before.has('payer_address'))
  await ensureColumns(client, 'payment_receipts', { payer_address: 'TEXT' })
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
      { id: TRADE_CHECKOUT_COLUMNS_MIGRATION_ID, run: reconcileTradeCheckoutColumns },
      { id: PAYMENT_RECEIPT_PAYER_MIGRATION_ID, run: reconcilePaymentReceiptPayer },
      { id: '2026-09-24-a2a-readonly-tasks-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS a2a_tasks (
          id TEXT PRIMARY KEY NOT NULL,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          context_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          request_message TEXT NOT NULL,
          artifact TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS a2a_tasks_agent_created_idx ON a2a_tasks(agent_id, created_at)')
        await database.execute('CREATE INDEX IF NOT EXISTS a2a_tasks_agent_context_idx ON a2a_tasks(agent_id, context_id)')
        await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS a2a_tasks_agent_message_idx ON a2a_tasks(agent_id, message_id)')
      } },
      { id: '2026-09-30-reusable-services-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS service_definitions (
          id TEXT PRIMARY KEY NOT NULL, seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          title TEXT NOT NULL, description TEXT NOT NULL, capabilities TEXT NOT NULL DEFAULT '[]',
          input_schema TEXT NOT NULL DEFAULT '{}', output_schema TEXT NOT NULL DEFAULT '{}',
          pricing_model TEXT NOT NULL DEFAULT 'fixed', price_minor INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'USD', estimated_latency_seconds INTEGER,
          max_concurrency INTEGER NOT NULL DEFAULT 1, active_orders INTEGER NOT NULL DEFAULT 0,
          execution_mode TEXT NOT NULL DEFAULT 'contracted', verification_policy TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'draft', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          CHECK(price_minor > 0), CHECK(max_concurrency > 0), CHECK(active_orders >= 0),
          CHECK(active_orders <= max_concurrency)
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS service_definitions_status_created_idx ON service_definitions(status, created_at)')
        await database.execute('CREATE INDEX IF NOT EXISTS service_definitions_seller_status_idx ON service_definitions(seller_id, status)')
        await database.execute(`CREATE TABLE IF NOT EXISTS service_orders (
          id TEXT PRIMARY KEY NOT NULL, service_id TEXT NOT NULL REFERENCES service_definitions(id) ON DELETE RESTRICT,
          listing_id TEXT NOT NULL UNIQUE REFERENCES listings(id) ON DELETE RESTRICT,
          trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
          buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          client_reference TEXT NOT NULL UNIQUE, objective TEXT NOT NULL, input_json TEXT NOT NULL DEFAULT '{}', price_minor INTEGER NOT NULL,
          payment_rail TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'awaiting_funding',
          capacity_released_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS service_orders_service_state_idx ON service_orders(service_id, state)')
        await database.execute('CREATE INDEX IF NOT EXISTS service_orders_buyer_created_idx ON service_orders(buyer_id, created_at)')
      } },
      { id: '2026-09-30-route-plans-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS route_plans (
          id TEXT PRIMARY KEY NOT NULL, buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          client_reference TEXT NOT NULL UNIQUE, objective TEXT NOT NULL,
          required_capabilities TEXT NOT NULL, input_json TEXT NOT NULL DEFAULT '{}',
          max_budget_minor INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
          deadline_seconds INTEGER, verification_policy TEXT NOT NULL DEFAULT '{}',
          payment_policy TEXT NOT NULL DEFAULT '{}', retry_policy TEXT NOT NULL DEFAULT '{}',
          candidates_json TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL DEFAULT 'planned',
          service_order_id TEXT REFERENCES service_orders(id) ON DELETE RESTRICT,
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          CHECK(max_budget_minor > 0)
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS route_plans_buyer_created_idx ON route_plans(buyer_id, created_at)')
        await database.execute('CREATE INDEX IF NOT EXISTS route_plans_state_expires_idx ON route_plans(state, expires_at)')
      } },
      { id: '2026-09-30-verification-results-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS verification_results (
          id TEXT PRIMARY KEY NOT NULL, trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE RESTRICT,
          delivery_id TEXT REFERENCES trade_deliveries(id) ON DELETE RESTRICT,
          content_hash TEXT NOT NULL, method TEXT NOT NULL, verifier TEXT NOT NULL,
          version TEXT NOT NULL, status TEXT NOT NULL, score REAL,
          evidence_json TEXT NOT NULL DEFAULT '{}', failure TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS verification_results_trade_content_method_version_idx ON verification_results(trade_id, content_hash, method, version)')
        await database.execute('CREATE INDEX IF NOT EXISTS verification_results_trade_status_idx ON verification_results(trade_id, status)')
        await database.execute('CREATE INDEX IF NOT EXISTS verification_results_delivery_idx ON verification_results(delivery_id)')
      } },
      { id: '2026-09-30-capability-performance-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS capability_performance_events (
          id TEXT PRIMARY KEY NOT NULL, trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE RESTRICT,
          service_order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE RESTRICT,
          seller_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
          capability_id TEXT NOT NULL, evidence_kind TEXT NOT NULL,
          verification_method TEXT NOT NULL, created_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS capability_performance_trade_capability_idx ON capability_performance_events(trade_id, capability_id)')
        await database.execute('CREATE INDEX IF NOT EXISTS capability_performance_agent_capability_idx ON capability_performance_events(seller_agent_id, capability_id)')
      } },
      { id: '2026-09-30-buyer-spend-policy-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS buyer_spend_policies (
          buyer_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          owner_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          policy_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )`)
        await database.execute(`CREATE TABLE IF NOT EXISTS buyer_spend_policy_events (
          id TEXT PRIMARY KEY NOT NULL, buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          actor_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          version INTEGER NOT NULL, old_policy_json TEXT, new_policy_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS buyer_spend_policy_events_buyer_version_idx ON buyer_spend_policy_events(buyer_id, version)')
      } },
      { id: '2026-09-30-route-attempts-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS route_attempts (
          id TEXT PRIMARY KEY NOT NULL, route_id TEXT NOT NULL REFERENCES route_plans(id) ON DELETE RESTRICT,
          attempt_number INTEGER NOT NULL, service_id TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'checking', failure_code TEXT,
          service_order_id TEXT REFERENCES service_orders(id) ON DELETE RESTRICT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS route_attempts_route_number_idx ON route_attempts(route_id, attempt_number)')
        await database.execute('CREATE INDEX IF NOT EXISTS route_attempts_route_state_idx ON route_attempts(route_id, state)')
      } },
      { id: '2026-09-30-workflow-plans-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY NOT NULL, buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          client_reference TEXT NOT NULL UNIQUE, objective TEXT NOT NULL, plan_json TEXT NOT NULL,
          max_budget_minor INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
          deadline_seconds INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'planned',
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          CHECK(max_budget_minor > 0)
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS workflows_buyer_created_idx ON workflows(buyer_id, created_at)')
        await database.execute(`CREATE TABLE IF NOT EXISTS workflow_nodes (
          id TEXT PRIMARY KEY NOT NULL, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
          node_key TEXT NOT NULL, objective TEXT NOT NULL, required_capabilities TEXT NOT NULL,
          depends_on TEXT NOT NULL DEFAULT '[]', budget_minor INTEGER NOT NULL,
          deadline_seconds INTEGER NOT NULL, depth INTEGER NOT NULL,
          state TEXT NOT NULL DEFAULT 'planned', route_id TEXT REFERENCES route_plans(id) ON DELETE RESTRICT,
          created_at INTEGER NOT NULL,
          CHECK(budget_minor > 0), CHECK(depth >= 0 AND depth <= 3)
        )`)
        await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS workflow_nodes_workflow_key_idx ON workflow_nodes(workflow_id, node_key)')
        await database.execute('CREATE INDEX IF NOT EXISTS workflow_nodes_workflow_state_idx ON workflow_nodes(workflow_id, state)')
      } },
      { id: '2026-09-30-enterprise-foundation-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS organizations (
          id TEXT PRIMARY KEY NOT NULL, owner_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          client_reference TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS organizations_owner_reference_idx ON organizations(owner_account_id, client_reference)')
        await database.execute('CREATE INDEX IF NOT EXISTS organizations_owner_created_idx ON organizations(owner_account_id, created_at)')
        await database.execute(`CREATE TABLE IF NOT EXISTS organization_agent_assignments (
          agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
          cost_center TEXT NOT NULL, assigned_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS organization_assignments_org_idx ON organization_agent_assignments(organization_id)')
        await database.execute(`CREATE TABLE IF NOT EXISTS organization_audit_events (
          id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
          actor_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          action TEXT NOT NULL, agent_id TEXT,
          cost_center TEXT, created_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS organization_audit_org_created_idx ON organization_audit_events(organization_id, created_at)')
      } },
      { id: '2026-09-30-enterprise-teams-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS organization_teams (
          id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
          slug TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS organization_teams_org_slug_idx ON organization_teams(organization_id, slug)')
        await database.execute('CREATE INDEX IF NOT EXISTS organization_teams_org_status_idx ON organization_teams(organization_id, status)')
        await ensureColumns(database, 'organization_agent_assignments', { team_id: 'TEXT REFERENCES organization_teams(id) ON DELETE RESTRICT' })
        await ensureColumns(database, 'organization_audit_events', { team_id: 'TEXT' })
      } },
      { id: '2026-09-30-enterprise-memberships-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS organization_invitations (
          id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
          client_reference TEXT NOT NULL, target_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          status TEXT NOT NULL DEFAULT 'pending', expires_at INTEGER NOT NULL,
          accepted_at INTEGER, cancelled_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_org_reference_idx ON organization_invitations(organization_id, client_reference)')
        await database.execute('CREATE INDEX IF NOT EXISTS organization_invitations_target_status_idx ON organization_invitations(target_account_id, status)')
        await database.execute(`CREATE TABLE IF NOT EXISTS organization_memberships (
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
          account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          role TEXT NOT NULL DEFAULT 'viewer', status TEXT NOT NULL DEFAULT 'active',
          accepted_invitation_id TEXT NOT NULL REFERENCES organization_invitations(id) ON DELETE RESTRICT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          PRIMARY KEY(organization_id, account_id)
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS organization_memberships_account_status_idx ON organization_memberships(account_id, status)')
        await ensureColumns(database, 'organization_audit_events', { member_account_id: 'TEXT' })
      } },
      { id: '2026-09-30-enterprise-service-accounts-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS organization_service_accounts (
          id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
          client_reference TEXT NOT NULL, name TEXT NOT NULL, lifetime_days INTEGER NOT NULL,
          credential_hash TEXT NOT NULL, credential_prefix TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active', expires_at INTEGER NOT NULL,
          revoked_at INTEGER, created_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS organization_service_accounts_org_reference_idx ON organization_service_accounts(organization_id, client_reference)')
        await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS organization_service_accounts_hash_idx ON organization_service_accounts(credential_hash)')
        await database.execute('CREATE INDEX IF NOT EXISTS organization_service_accounts_org_status_idx ON organization_service_accounts(organization_id, status)')
        await ensureColumns(database, 'organization_audit_events', { service_account_id: 'TEXT' })
      } },
      { id: '2026-09-30-enterprise-budgets-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS organization_spend_budgets (
          organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
          max_per_execution_minor INTEGER, max_daily_minor INTEGER, max_monthly_minor INTEGER,
          version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          CHECK(max_per_execution_minor IS NULL OR max_per_execution_minor > 0),
          CHECK(max_daily_minor IS NULL OR max_daily_minor > 0),
          CHECK(max_monthly_minor IS NULL OR max_monthly_minor > 0)
        )`)
        await database.execute(`CREATE TABLE IF NOT EXISTS organization_trade_attributions (
          trade_id TEXT PRIMARY KEY NOT NULL REFERENCES trades(id) ON DELETE RESTRICT,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
          agent_id TEXT NOT NULL, team_id TEXT, cost_center TEXT NOT NULL,
          total_minor INTEGER NOT NULL CHECK(total_minor > 0), created_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS organization_trade_attributions_org_created_idx ON organization_trade_attributions(organization_id, created_at)')
        await database.execute(`CREATE TABLE IF NOT EXISTS organization_budget_events (
          id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
          actor_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          version INTEGER NOT NULL, old_budget_json TEXT, new_budget_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS organization_budget_events_org_version_idx ON organization_budget_events(organization_id, version)')
      } },
      { id: '2026-10-01-service-order-execution-v1', run: async (database: Client) => {
        await ensureColumns(database, 'service_orders', { execution_started_at: 'INTEGER' })
      } },
      { id: '2026-10-01-service-provider-protocol-v1', run: async (database: Client) => {
        await ensureColumns(database, 'service_definitions', { provider_protocol: "TEXT NOT NULL DEFAULT 'manual'" })
        await database.execute(`CREATE TABLE IF NOT EXISTS service_execution_attempts (
          id TEXT PRIMARY KEY NOT NULL,
          order_id TEXT NOT NULL UNIQUE REFERENCES service_orders(id) ON DELETE RESTRICT,
          state TEXT NOT NULL DEFAULT 'queued', accepted_at INTEGER, heartbeat_at INTEGER,
          lease_expires_at INTEGER, completed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )`)
        await database.execute('CREATE INDEX IF NOT EXISTS service_execution_attempts_state_lease_idx ON service_execution_attempts(state, lease_expires_at)')
      } },
      { id: '2026-10-01-worker-heartbeats-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS worker_heartbeats (
          worker_name TEXT PRIMARY KEY NOT NULL,
          last_started_at INTEGER, last_succeeded_at INTEGER, last_failed_at INTEGER,
          last_outcome TEXT
        )`)
      } },
      { id: '2026-10-01-stale-work-notification-v1', run: async (database: Client) => {
        await ensureColumns(database, 'webhook_deliveries', { suppressed_at: 'INTEGER' })
      } },
      { id: '2026-10-02-provider-acknowledgment-deadline-v1', run: async (database: Client) => {
        await ensureColumns(database, 'service_execution_attempts', { acknowledgment_due_at: 'INTEGER' })
        await database.execute('UPDATE service_execution_attempts SET acknowledgment_due_at = created_at + 600 WHERE acknowledgment_due_at IS NULL')
        await database.execute('CREATE INDEX IF NOT EXISTS service_execution_attempts_state_ack_idx ON service_execution_attempts(state, acknowledgment_due_at)')
      } },
      { id: '2026-10-02-buyer-provider-requirements-v1', run: async (database: Client) => {
        await ensureColumns(database, 'service_orders', { provider_requirements_json: "TEXT NOT NULL DEFAULT '{}'", execution_contract_json: 'TEXT' })
        await ensureColumns(database, 'route_plans', { provider_requirements_json: "TEXT NOT NULL DEFAULT '{}'" })
      } },
      { id: '2026-10-02-private-artifacts-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS private_artifacts (
  id TEXT PRIMARY KEY NOT NULL, trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE RESTRICT,
  order_id TEXT REFERENCES service_orders(id) ON DELETE RESTRICT, route_id TEXT REFERENCES route_plans(id) ON DELETE RESTRICT,
  delivery_id TEXT REFERENCES trade_deliveries(id) ON DELETE RESTRICT, uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL, request_hash TEXT NOT NULL, name TEXT NOT NULL, media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, provenance_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, retention_expires_at INTEGER NOT NULL, purged_at INTEGER
)`)
        await database.execute(`CREATE UNIQUE INDEX IF NOT EXISTS private_artifacts_trade_reference_idx ON private_artifacts(trade_id, client_reference)`)
        await database.execute(`CREATE INDEX IF NOT EXISTS private_artifacts_retention_idx ON private_artifacts(retention_expires_at, purged_at)`)
        await database.execute(`CREATE TABLE IF NOT EXISTS private_artifact_payloads (
  artifact_id TEXT PRIMARY KEY NOT NULL REFERENCES private_artifacts(id) ON DELETE RESTRICT,
  ciphertext TEXT NOT NULL, nonce TEXT NOT NULL
)`)
      } },
      { id: '2026-10-03-private-verification-jobs-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS verification_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  verifier_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  artifact_id TEXT NOT NULL REFERENCES private_artifacts(id) ON DELETE RESTRICT,
  artifact_sha256 TEXT NOT NULL, client_reference TEXT NOT NULL, request_hash TEXT NOT NULL,
  policy_json TEXT NOT NULL, suite_ciphertext TEXT, suite_nonce TEXT, case_count INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', report_json TEXT, report_hash TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, completed_at INTEGER
)`)
        await database.execute(`CREATE UNIQUE INDEX IF NOT EXISTS verification_jobs_trade_reference_idx ON verification_jobs(trade_id, client_reference)`)
        await database.execute(`CREATE INDEX IF NOT EXISTS verification_jobs_verifier_state_idx ON verification_jobs(verifier_agent_id, state, expires_at)`)
      } },
      { id: '2026-10-03-route-payment-mandates-v1', run: async (database: Client) => {
        await database.execute(`CREATE TABLE IF NOT EXISTS route_payment_mandates (
  id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL UNIQUE REFERENCES route_plans(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  owner_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL, request_hash TEXT NOT NULL, route_hash TEXT NOT NULL,
  terms_json TEXT NOT NULL, max_aggregate_minor INTEGER NOT NULL,
  reserved_minor INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'active',
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER
)`)
        await database.execute(`CREATE UNIQUE INDEX IF NOT EXISTS route_payment_mandates_owner_reference_idx ON route_payment_mandates(owner_account_id, client_reference)`)
        await database.execute(`CREATE TABLE IF NOT EXISTS route_funding_steps (
  id TEXT PRIMARY KEY NOT NULL,
  mandate_id TEXT NOT NULL REFERENCES route_payment_mandates(id) ON DELETE RESTRICT,
  route_id TEXT NOT NULL UNIQUE REFERENCES route_plans(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE RESTRICT,
  trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL, terms_hash TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'reserved',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
)`)
      } },
    ]
    migrations.push({ id: '2026-10-03-buyer-evm-payment-claims-v1', run: async (database: Client) => {
      await database.execute(`CREATE TABLE IF NOT EXISTS buyer_evm_payment_claims (
  intent_id TEXT PRIMARY KEY NOT NULL REFERENCES evm_payment_intents(id) ON DELETE RESTRICT,
  mandate_id TEXT NOT NULL REFERENCES route_payment_mandates(id) ON DELETE RESTRICT,
  chain_id INTEGER NOT NULL, payer_address TEXT NOT NULL, nonce INTEGER NOT NULL,
  tx_hash TEXT NOT NULL, terms_hash TEXT NOT NULL, maximum_execution_gas_cost_wei TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'claimed', created_at INTEGER NOT NULL
)`)
      await database.execute(`CREATE UNIQUE INDEX IF NOT EXISTS buyer_evm_payment_claims_wallet_nonce_idx ON buyer_evm_payment_claims(chain_id, payer_address, nonce)`)
      await database.execute(`CREATE UNIQUE INDEX IF NOT EXISTS buyer_evm_payment_claims_active_wallet_idx ON buyer_evm_payment_claims(chain_id, payer_address) WHERE state = 'claimed'`)
    } })
    migrations.push({ id: '2026-10-03-buyer-payment-operation-v1', run: async (database: Client) => {
      await ensureColumns(database, 'evm_payment_intents', { buyer_operation_id: 'TEXT' })
      await database.execute(`CREATE UNIQUE INDEX IF NOT EXISTS evm_payment_intents_buyer_operation_idx ON evm_payment_intents(buyer_operation_id)`)
    } })
    migrations.push({ id: '2026-10-03-backed-account-credit-v1', run: async (database: Client) => {
      await database.execute(`CREATE TABLE IF NOT EXISTS credit_accounts (
        user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        available_minor INTEGER NOT NULL DEFAULT 0, escrow_minor INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT credit_accounts_nonnegative CHECK(available_minor >= 0 AND escrow_minor >= 0))`)
      await database.execute(`CREATE TABLE IF NOT EXISTS credit_entries (
        id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        reference TEXT NOT NULL, kind TEXT NOT NULL, available_delta INTEGER NOT NULL, escrow_delta INTEGER NOT NULL, created_at INTEGER NOT NULL)`)
      await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS credit_entries_reference_idx ON credit_entries(user_id, reference, kind)')
      await database.execute(`CREATE TABLE IF NOT EXISTS credit_deposits (
        id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        client_reference TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
        payer TEXT NOT NULL, treasury TEXT NOT NULL, token TEXT NOT NULL, chain_id INTEGER NOT NULL,
        tx_hash TEXT, payer_signature TEXT, state TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`)
      await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS credit_deposits_reference_idx ON credit_deposits(user_id, client_reference)')
      await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS credit_deposits_hash_idx ON credit_deposits(tx_hash)')
    } })
    migrations.push({ id: '2026-10-03-buyer-mpp-payment-claims-v1', run: async (database: Client) => {
      await database.executeMultiple(await readFile(new URL('../migrations/2026-10-03-buyer-mpp-payment-claims-v1.sql', import.meta.url), 'utf8'))
    } })
    migrations.push({ id: '2026-10-03-route-receipts-v1', run: async (database: Client) => {
      await database.executeMultiple(await readFile(new URL('../migrations/2026-10-03-route-receipts-v1.sql', import.meta.url), 'utf8'))
    } })
    migrations.push({ id: '2026-10-03-route-funded-retry-v1', run: async (database: Client) => {
      await ensureColumns(database, 'route_plans', { execution_deadline_at: 'INTEGER' })
      await database.executeMultiple(await readFile(new URL('../migrations/2026-10-03-route-funded-retry-v1.sql', import.meta.url), 'utf8'))
    } })
    migrations.push({ id: '2026-10-03-route-automation-evidence-v1', run: async (database: Client) => {
      await database.executeMultiple(await readFile(new URL('../migrations/2026-10-03-route-automation-evidence-v1.sql', import.meta.url), 'utf8'))
    } })
    migrations.push({ id: '2026-10-03-route-admission-control-v1', run: async (database: Client) => {
      await database.executeMultiple(await readFile(new URL('../migrations/2026-10-03-route-admission-control-v1.sql', import.meta.url), 'utf8'))
    } })
    migrations.push({ id: '2026-10-03-instant-metered-sessions-v1', run: async (database: Client) => {
      await database.executeMultiple(await readFile(new URL('../migrations/2026-10-03-instant-metered-sessions-v1.sql', import.meta.url), 'utf8'))
    } })
    migrations.push({ id: '2026-10-04-a2a-routing-tasks-v1', run: async (database: Client) => {
      await database.executeMultiple(await readFile(new URL('../migrations/2026-10-04-a2a-routing-tasks-v1.sql', import.meta.url), 'utf8'))
    } })
    migrations.push({ id: '2026-10-04-mcp-routing-tasks-v1', run: async (database: Client) => {
      await database.executeMultiple(await readFile(new URL('../migrations/2026-10-04-mcp-routing-tasks-v1.sql', import.meta.url), 'utf8'))
    } })
    migrations.push({ id: '2026-10-08-contract-account-credit-v1', run: async (database: Client) => {
      await ensureColumns(database, 'contracts', { payment_rail: "TEXT NOT NULL DEFAULT 'ledger'", funded_at: 'INTEGER', organization_id: 'TEXT' })
    } })
    migrations.push({ id: '2026-10-08-peer-benchmark-authority-v1', run: async (database: Client) => {
      await database.executeMultiple(await readFile(new URL('../migrations/2026-10-08-peer-benchmark-authority-v1.sql', import.meta.url), 'utf8'))
      await ensureColumns(database, 'benchmarks', { evaluator_agent_id: 'TEXT', client_reference: 'TEXT' })
      await database.execute('CREATE UNIQUE INDEX IF NOT EXISTS benchmarks_evaluator_reference_idx ON benchmarks(evaluator_agent_id, client_reference)')
    } })
    migrations.push({ id: '2026-10-08-trusted-benchmarks-v1', run: async (database: Client) => {
      await database.executeMultiple(await readFile(new URL('../migrations/2026-10-08-trusted-benchmarks-v1.sql', import.meta.url), 'utf8'))
    } })
    migrations.push({ id: '2026-10-08-capability-cycle-search-v1', run: async (database: Client) => {
      await database.executeMultiple(await readFile(new URL('../migrations/2026-10-08-capability-cycle-search-v1.sql', import.meta.url), 'utf8'))
    } })
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
