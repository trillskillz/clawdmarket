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
    await client.execute(`CREATE TABLE service_execution_attempts (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
      accepted_at INTEGER, heartbeat_at INTEGER, lease_expires_at INTEGER, completed_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    for (const state of ['queued', 'accepted', 'delivered']) await client.execute({
      sql: 'INSERT INTO service_execution_attempts (id, order_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      args: [`legacy-${state}`, `order-${state}`, state, 1000, 1001],
    })
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
      assert.equal(names(agents.rows).has('api_key_revoked_at'), true)
      assert.equal(names(agents.rows).has('previous_api_key'), true)
      assert.equal(names(agents.rows).has('previous_api_key_expires_at'), true)
      assert.equal(names(agents.rows).has('visibility'), true)
      assert.equal(names(agents.rows).has('lifecycle_mode'), true)
      assert.equal(names(agents.rows).has('archived_at'), true)
      assert.equal(names(trades.rows).has('payment_rail'), true)
      assert.equal(names(trades.rows).has('auto_confirm_at'), true)
      assert.equal(names(trades.rows).has('rating_window_expires_at'), true)
      assert.equal(names(trades.rows).has('dev_amount'), true)
      assert.equal(names(bids.rows).has('counter_offer_status'), true)
      assert.equal(names(receipts.rows).has('currency'), true)
      assert.equal(names(receipts.rows).has('payer_address'), true)
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
      assert.equal(tableNames.has('agent_lifecycle_events'), true)
      assert.equal(tableNames.has('agent_credentials'), true)
      assert.equal(tableNames.has('agent_owners'), true)
      assert.equal(tableNames.has('agent_ownership_transfers'), true)
      assert.equal(tableNames.has('reference_fleet_controls'), true)
      assert.equal(tableNames.has('reference_fleet_control_events'), true)
      assert.equal(tableNames.has('reference_fleet_execution_runs'), true)
      assert.equal(tableNames.has('a2a_tasks'), true)
      assert.equal(tableNames.has('service_definitions'), true)
      assert.equal(tableNames.has('service_orders'), true)
      assert.equal(tableNames.has('route_plans'), true)
      assert.equal(tableNames.has('route_attempts'), true)
      assert.equal(tableNames.has('workflows'), true)
      assert.equal(tableNames.has('workflow_nodes'), true)
      assert.equal(tableNames.has('organizations'), true)
      assert.equal(tableNames.has('organization_teams'), true)
      assert.equal(tableNames.has('organization_invitations'), true)
      assert.equal(tableNames.has('organization_memberships'), true)
      assert.equal(tableNames.has('organization_service_accounts'), true)
      assert.equal(tableNames.has('organization_spend_budgets'), true)
      assert.equal(tableNames.has('organization_trade_attributions'), true)
      assert.equal(tableNames.has('organization_budget_events'), true)
      assert.equal(tableNames.has('organization_agent_assignments'), true)
      assert.equal(tableNames.has('organization_audit_events'), true)
      assert.equal(tableNames.has('verification_results'), true)
      assert.equal(tableNames.has('private_artifacts'), true)
      assert.equal(tableNames.has('private_artifact_payloads'), true)
      assert.equal(tableNames.has('capability_performance_events'), true)
      assert.equal(tableNames.has('buyer_spend_policies'), true)
      assert.equal(tableNames.has('buyer_spend_policy_events'), true)
      assert.equal(tableNames.has('service_execution_attempts'), true)
      const providerAttempts = await migrated.execute('PRAGMA table_info("service_execution_attempts")')
      assert.equal(names(providerAttempts.rows).has('acknowledgment_due_at'), true)
      const deadlines = await migrated.execute('SELECT state, acknowledgment_due_at, created_at, updated_at FROM service_execution_attempts ORDER BY state')
      assert.deepEqual(deadlines.rows.map((row) => ({ state: row.state, due: row.acknowledgment_due_at, created: row.created_at, updated: row.updated_at })),
        ['accepted', 'delivered', 'queued'].map((state) => ({ state, due: 1600, created: 1000, updated: 1001 })))
      assert.equal(tableNames.has('worker_heartbeats'), true)
      const workerHeartbeats = await migrated.execute('PRAGMA table_info("worker_heartbeats")')
      assert.equal(names(workerHeartbeats.rows).has('last_outcome'), true)
      const serviceDefinitions = await migrated.execute('PRAGMA table_info("service_definitions")')
      const serviceOrders = await migrated.execute('PRAGMA table_info("service_orders")')
      assert.equal(names(serviceDefinitions.rows).has('active_orders'), true)
      assert.equal(names(serviceDefinitions.rows).has('provider_protocol'), true)
      assert.equal(names(serviceOrders.rows).has('capacity_released_at'), true)
      assert.equal(names(serviceOrders.rows).has('objective'), true)
      assert.equal(names(serviceOrders.rows).has('execution_started_at'), true)
      assert.equal(names(serviceOrders.rows).has('provider_requirements_json'), true)
      assert.equal(names(serviceOrders.rows).has('execution_contract_json'), true)
      const routePlans = await migrated.execute('PRAGMA table_info("route_plans")')
      assert.equal(names(routePlans.rows).has('provider_requirements_json'), true)
      const workflowNodes = await migrated.execute('PRAGMA table_info("workflow_nodes")')
      const organizationAssignments = await migrated.execute('PRAGMA table_info("organization_agent_assignments")')
      const organizationAudit = await migrated.execute('PRAGMA table_info("organization_audit_events")')
      assert.equal(names(organizationAssignments.rows).has('team_id'), true)
      assert.equal(names(organizationAudit.rows).has('team_id'), true)
      assert.equal(names(organizationAudit.rows).has('member_account_id'), true)
      assert.equal(names(organizationAudit.rows).has('service_account_id'), true)
      assert.equal(names(workflowNodes.rows).has('budget_minor'), true)
      assert.equal(names(workflowNodes.rows).has('route_id'), true)
      const intents = await migrated.execute('PRAGMA table_info("evm_payment_intents")')
      assert.equal(names(intents.rows).has('payer_signature'), true)
      const webhookDeliveries = await migrated.execute('PRAGMA table_info("webhook_deliveries")')
      assert.equal(names(webhookDeliveries.rows).has('next_attempt_at'), true)
      assert.equal(names(webhookDeliveries.rows).has('last_error'), true)
      assert.equal(names(webhookDeliveries.rows).has('suppressed_at'), true)
      assert.equal(migrationRows.rows.length, 36)
      assert.equal(tableNames.has('verification_jobs'), true)
      const verificationJobs = await migrated.execute('PRAGMA table_info("verification_jobs")')
      assert.equal(names(verificationJobs.rows).has('suite_ciphertext'), true)
      assert.equal(names(verificationJobs.rows).has('report_hash'), true)
    } finally {
      migrated.close()
    }
  } finally {
    client.close()
    await rm(directory, { recursive: true, force: true })
  }
})
