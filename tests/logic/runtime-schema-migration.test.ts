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
      'CREATE TABLE trades (id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL, status TEXT NOT NULL)',
      "INSERT INTO trades (id, buyer_id, status) VALUES ('legacy-financial-trade', 'legacy-buyer', 'completed')",
      'CREATE TABLE payment_receipts (id TEXT PRIMARY KEY)',
      'CREATE TABLE bids (id TEXT PRIMARY KEY)',
      'CREATE TABLE webhooks (id TEXT PRIMARY KEY, url TEXT NOT NULL, events TEXT NOT NULL, created_at TEXT NOT NULL)',
      "INSERT INTO webhooks (id, url, events, created_at) VALUES ('legacy-webhook', 'https://example.com/hook', '[]', datetime('now'))",
      "CREATE TABLE benchmarks (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, task_id TEXT, capability TEXT NOT NULL, test_input TEXT NOT NULL, test_output TEXT, scoring_rubric TEXT, score REAL, scored_by_agent_id TEXT, status TEXT NOT NULL DEFAULT 'pending', run_time_ms INTEGER, notes TEXT, created_at TEXT NOT NULL, scored_at TEXT)",
      "INSERT INTO benchmarks (id, agent_id, capability, test_input, score, scored_by_agent_id, status, created_at) VALUES ('legacy-benchmark', 'legacy-agent', 'analysis', 'LEGACY_PRIVATE_TEST', 88, 'legacy-scorer', 'scored', '2026-09-01')",
    ]) await client.execute(statement)
    await client.execute(`CREATE TABLE service_execution_attempts (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
      accepted_at INTEGER, heartbeat_at INTEGER, lease_expires_at INTEGER, completed_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    for (const state of ['queued', 'accepted', 'delivered']) await client.execute({
      sql: 'INSERT INTO service_execution_attempts (id, order_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      args: [`legacy-${state}`, `order-${state}`, state, 1000, 1001],
    })
    // Original service/order rows predate visibility and sharing; the additive upgrade must not reclassify or rewrite them.
    await client.execute(`CREATE TABLE service_definitions (
      id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '[]', input_schema TEXT NOT NULL DEFAULT '{}', output_schema TEXT NOT NULL DEFAULT '{}',
      pricing_model TEXT NOT NULL DEFAULT 'fixed', price_minor INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
      estimated_latency_seconds INTEGER, max_concurrency INTEGER NOT NULL DEFAULT 1, active_orders INTEGER NOT NULL DEFAULT 0,
      execution_mode TEXT NOT NULL DEFAULT 'contracted', verification_policy TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    await client.execute("INSERT INTO service_definitions (id,seller_id,title,description,price_minor,status,created_at,updated_at) VALUES ('legacy-service','legacy-seller','Original service','Original terms',123,'active',1000,1001)")
    await client.execute(`CREATE TABLE service_orders (
      id TEXT PRIMARY KEY, service_id TEXT NOT NULL, listing_id TEXT NOT NULL UNIQUE, trade_id TEXT NOT NULL UNIQUE,
      buyer_id TEXT NOT NULL, client_reference TEXT NOT NULL UNIQUE, objective TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}', price_minor INTEGER NOT NULL, payment_rail TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'awaiting_funding', capacity_released_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    await client.execute("INSERT INTO service_orders (id,service_id,listing_id,trade_id,buyer_id,client_reference,objective,input_json,price_minor,payment_rail,state,created_at,updated_at) VALUES ('legacy-order','legacy-service','legacy-listing','legacy-financial-trade','legacy-buyer','original-reference','Original objective','{\"secret\":\"original input\"}',123,'mpp','completed',1000,1001)")
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
      assert.equal(names(receipts.rows).has('chain_fee_evidence_json'), true)
      assert.equal(names((await migrated.execute('PRAGMA table_info("settlement_transfers")')).rows).has('chain_fee_evidence_json'), true)
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
      assert.equal(names(serviceDefinitions.rows).has('visibility'),true)
      assert.equal(serviceDefinitions.rows.find(row=>row.name==='visibility')?.dflt_value,"'public'")
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
      assert.equal(names(serviceOrders.rows).has('purchasing_approval_id'), true)
      assert.equal(names(serviceOrders.rows).has('private_provider_share_id'), true)
      const originalService=(await migrated.execute("SELECT * FROM service_definitions WHERE id='legacy-service'")).rows[0]
      assert.equal(originalService.visibility,'public');assert.equal(originalService.price_minor,123);assert.equal(originalService.title,'Original service')
      const originalOrder=(await migrated.execute("SELECT * FROM service_orders WHERE id='legacy-order'")).rows[0]
      assert.equal(originalOrder.private_provider_share_id,null);assert.equal(originalOrder.purchasing_approval_id,null)
      assert.equal(originalOrder.trade_id,'legacy-financial-trade');assert.equal(originalOrder.payment_rail,'mpp');assert.equal(originalOrder.price_minor,123)
      assert.equal(originalOrder.input_json,'{"secret":"original input"}');assert.equal(originalOrder.state,'completed')
      assert.equal(migrationRows.rows.length, 59)
      for (const table of ['organization_provider_shares', 'organization_purchasing_roles', 'organization_purchase_requests', 'organization_purchase_approvals', 'organization_purchase_uses', 'organization_team_budgets', 'organization_team_budget_events', 'organization_contract_attributions']) {
        assert.equal(tableNames.has(table), true)
        assert.equal((await migrated.execute(`SELECT * FROM ${table}`)).rows.length, 0)
      }
      assert.equal(tableNames.has('workflow_runs'), true)
      assert.equal(tableNames.has('workflow_node_runs'), true)
      assert.equal(tableNames.has('workflow_reservations'), true)
      assert.equal(tableNames.has('workflow_dependency_bindings'), true)
      assert.equal(tableNames.has('workflow_artifact_grants'), true)
      assert.equal(tableNames.has('workflow_receipts'), true)
      assert.equal(tableNames.has('workflow_approvals'), true)
      const approvals = await migrated.execute('PRAGMA table_info("workflow_approvals")')
      assert.equal(names(approvals.rows).has('contract_hash'), true)
      assert.equal(names(approvals.rows).has('revoked_by'), true)
      assert.equal((await migrated.execute('SELECT * FROM workflow_approvals')).rows.length, 0)
      const tradeIndexes = await migrated.execute('PRAGMA index_list("trades")')
      assert.equal(names(tradeIndexes.rows).has('trades_buyer_status_idx'), true)
      const legacyTrade = (await migrated.execute("SELECT buyer_id, status FROM trades WHERE id = 'legacy-financial-trade'")).rows[0]
      assert.equal(legacyTrade.buyer_id, 'legacy-buyer')
      assert.equal(legacyTrade.status, 'completed')
      assert.equal(tableNames.has('benchmark_definitions'), true)
      assert.equal(tableNames.has('benchmark_runs'), true)
      const benchmarkRunIndexes = await migrated.execute('PRAGMA index_list("benchmark_runs")')
      assert.equal(names(benchmarkRunIndexes.rows).has('benchmark_run_reference_idx'), true)
      const legacyBenchmark = (await migrated.execute("SELECT * FROM benchmarks WHERE id = 'legacy-benchmark'")).rows[0]
      assert.equal(legacyBenchmark.test_input, 'LEGACY_PRIVATE_TEST')
      assert.equal(legacyBenchmark.score, 88)
      assert.equal(legacyBenchmark.scored_by_agent_id, 'legacy-scorer')
      assert.equal(legacyBenchmark.evaluator_agent_id, null)
      assert.equal(legacyBenchmark.client_reference, null)
      const benchmarkIndexes = (await migrated.execute('PRAGMA index_list("benchmarks")')).rows
      assert.equal(benchmarkIndexes.some((row) => row.name === 'benchmarks_evaluator_reference_idx' && row.unique === 1), true)
      assert.equal((await migrated.execute('PRAGMA integrity_check')).rows[0].integrity_check, 'ok')
      const contractColumns = names((await migrated.execute('PRAGMA table_info("contracts")')).rows)
      for (const column of ['payment_rail', 'funded_at', 'organization_id']) assert.equal(contractColumns.has(column), true)
      for (const table of ['buyer_mpp_payment_intents', 'buyer_mpp_payment_claims', 'route_receipts', 'route_retry_funding_steps', 'route_origins', 'route_agent_decisions', 'route_controls', 'route_control_events']) assert.equal(tableNames.has(table), true)
      for (const table of ['credit_accounts', 'credit_entries', 'credit_deposits', 'instant_services', 'instant_sessions', 'instant_calls', 'a2a_route_tasks', 'a2a_message_claims']) assert.equal(tableNames.has(table), true)
      for (const table of ['mcp_route_tasks', 'mcp_result_streams']) assert.equal(tableNames.has(table), true)
      assert.equal(names((await migrated.execute('PRAGMA table_info("mcp_route_tasks")')).rows).has('terminal_status'), true)
      await migrated.execute("INSERT INTO users (id) VALUES ('credit-check')")
      await migrated.execute("INSERT INTO credit_accounts (user_id) VALUES ('credit-check')")
      await assert.rejects(migrated.execute("UPDATE credit_accounts SET available_minor = -1 WHERE user_id = 'credit-check'"), /CHECK constraint/)
      assert.equal(tableNames.has('verification_jobs'), true)
      assert.equal(tableNames.has('route_payment_mandates'), true)
      assert.equal(tableNames.has('route_funding_steps'), true)
      assert.equal(tableNames.has('buyer_evm_payment_claims'), true)
      assert.equal(names((await migrated.execute('PRAGMA table_info("evm_payment_intents")')).rows).has('buyer_operation_id'), true)
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
