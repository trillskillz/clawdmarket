import { inspectRouteReceiptHealth } from '../lib/route-receipt-health.mjs'
import { inspectCreditHealth } from '../lib/credit-health.mjs'
import { createClient } from '@libsql/client'
import { inspectLegacyOwnerValues } from '../lib/legacy-owner-classification.mjs'
import { inspectRouteFundingHealth } from '../lib/route-funding-health.mjs'

const url = process.env.TURSO_DATABASE_URL || ''
const authToken = process.env.TURSO_AUTH_TOKEN || ''
if (!url.startsWith('libsql://') || !authToken) throw new Error('Production Turso credentials are required')
const client = createClient({ url, authToken })
try {
  const read = async (sql) => (await client.execute(sql)).rows
  const [migrations, services, routes, orders, attempts, provider, missingAttempts, overdueDeliveries, webhooks, transfers, worker, legacyOwner, artifacts, verifierJobs, fundingHealth, creditHealth, receiptHealth] = await Promise.all([
    read('SELECT COUNT(*) AS count FROM _clawdmarket_migrations'),
    read('SELECT status AS state, COUNT(*) AS count FROM service_definitions GROUP BY status'),
    read('SELECT state, COUNT(*) AS count FROM route_plans GROUP BY state'),
    read('SELECT state, COUNT(*) AS count FROM service_orders GROUP BY state'),
    read('SELECT state, COUNT(*) AS count FROM service_execution_attempts GROUP BY state'),
    read(`SELECT
      COUNT(CASE WHEN a.state = 'queued' AND COALESCE(a.acknowledgment_due_at, a.created_at + 600) <= unixepoch()
        AND t.status = 'escrow_held' AND o.state = 'funded' AND o.capacity_released_at IS NULL THEN 1 END) AS acknowledgment_overdue_count,
      COUNT(CASE WHEN a.state = 'acknowledgment_timed_out' AND t.status = 'escrow_held'
        AND o.state = 'funded' AND o.capacity_released_at IS NULL THEN 1 END) AS acknowledgment_timed_out_count,
      COUNT(CASE WHEN a.state = 'accepted' AND a.lease_expires_at <= unixepoch() THEN 1 END) AS overdue_lease_count,
      COUNT(CASE WHEN a.state IN ('queued', 'accepted') AND (t.status != 'escrow_held' OR o.capacity_released_at IS NOT NULL) THEN 1 END) AS terminal_active_count
      FROM service_execution_attempts a JOIN service_orders o ON o.id = a.order_id JOIN trades t ON t.id = o.trade_id`),
    read(`SELECT COUNT(*) AS count FROM service_orders o
      JOIN service_definitions s ON s.id = o.service_id JOIN trades t ON t.id = o.trade_id
      LEFT JOIN service_execution_attempts a ON a.order_id = o.id
      WHERE (CASE WHEN o.execution_contract_json IS NULL THEN s.provider_protocol
        WHEN json_valid(o.execution_contract_json) THEN json_extract(o.execution_contract_json, '$.provider_protocol') END) = 'leased_v1' AND t.status = 'escrow_held'
        AND o.state IN ('funded', 'executing') AND o.capacity_released_at IS NULL AND a.id IS NULL`),
    read(`SELECT COUNT(*) AS count FROM route_plans r
      JOIN service_orders o ON o.id = r.service_order_id JOIN trades t ON t.id = o.trade_id
      WHERE t.status = 'escrow_held' AND o.state IN ('funded', 'executing')
        AND o.capacity_released_at IS NULL AND r.deadline_seconds IS NOT NULL
        AND unixepoch(t.funded_at) + r.deadline_seconds <= unixepoch()`),
    read(`SELECT
      SUM(CASE WHEN success = 0 AND suppressed_at IS NULL AND attempts < 8 THEN 1 ELSE 0 END) AS retrying_count,
      SUM(CASE WHEN success = 0 AND suppressed_at IS NULL AND attempts >= 8 THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN success = 0 AND suppressed_at IS NULL AND attempts < 8 AND next_attempt_at IS NOT NULL AND next_attempt_at < unixepoch() - 900 THEN 1 ELSE 0 END) AS overdue_count
      FROM webhook_deliveries`),
    read(`SELECT
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN status IN ('pending', 'signing', 'prepared', 'submitted') AND updated_at < unixepoch() - 900 THEN 1 ELSE 0 END) AS stuck_count
      FROM settlement_transfers`),
    read("SELECT last_outcome, last_succeeded_at FROM worker_heartbeats WHERE worker_name = 'webhooks' LIMIT 1"),
    inspectLegacyOwnerValues(client),
    read(`SELECT COUNT(*) AS count, COALESCE(SUM(a.size_bytes), 0) AS declared_bytes,
      COUNT(CASE WHEN a.delivery_id IS NOT NULL THEN 1 END) AS delivered_count,
      COUNT(CASE WHEN a.purged_at IS NOT NULL THEN 1 END) AS purged_count,
      COUNT(CASE WHEN a.purged_at IS NULL AND p.artifact_id IS NULL
        AND (t.status NOT IN ('completed', 'cancelled', 'resolved') OR a.retention_expires_at > unixepoch()) THEN 1 END) AS missing_live_payload_count,
      COUNT(CASE WHEN a.purged_at IS NOT NULL AND p.artifact_id IS NOT NULL THEN 1 END) AS purged_with_payload_count,
      COUNT(CASE WHEN a.purged_at IS NULL AND p.artifact_id IS NOT NULL AND a.retention_expires_at < unixepoch() - 900
        AND t.status IN ('completed', 'cancelled', 'resolved') THEN 1 END) AS overdue_purge_count
      FROM private_artifacts a JOIN trades t ON t.id = a.trade_id
      LEFT JOIN private_artifact_payloads p ON p.artifact_id = a.id`),
    read(`SELECT COUNT(CASE WHEN state = 'pending' THEN 1 END) AS pending_count,
      COUNT(CASE WHEN state = 'pending' AND expires_at <= unixepoch() THEN 1 END) AS overdue_count,
      COUNT(CASE WHEN state != 'pending' AND (suite_ciphertext IS NOT NULL OR suite_nonce IS NOT NULL) THEN 1 END) AS retained_suite_anomaly_count
      FROM verification_jobs`),
    inspectRouteFundingHealth(client),
    inspectCreditHealth(client),
    inspectRouteReceiptHealth(client),
  ])
  const states = (rows) => Object.fromEntries(rows.map((row) => [String(row.state), Number(row.count || 0)]))
  const workerRow = worker[0]
  const workerAgeMinutes = workerRow?.last_succeeded_at ? Math.round((Date.now() - Number(workerRow.last_succeeded_at) * 1000) / 60000) : null
  const snapshot = {
    migrations: Number(migrations[0]?.count || 0), services: states(services), routes: states(routes), orders: states(orders), attempts: states(attempts),
    provider_execution: { ...Object.fromEntries(Object.entries(provider[0] || {}).map(([key, value]) => [key, Number(value || 0)])),
      funded_without_attempt_count: Number(missingAttempts[0]?.count || 0),
      delivery_deadline_overdue_count: Number(overdueDeliveries[0]?.count || 0) },
    webhook_outbox: Object.fromEntries(Object.entries(webhooks[0] || {}).map(([key, value]) => [key, Number(value || 0)])),
    settlement_outbox: Object.fromEntries(Object.entries(transfers[0] || {}).map(([key, value]) => [key, Number(value || 0)])),
    webhook_worker: { outcome: workerRow?.last_outcome || 'never_observed', age_minutes: workerAgeMinutes },
    legacy_owner_values: legacyOwner,
    verification_jobs: Object.fromEntries(Object.entries(verifierJobs[0] || {}).map(([key, value]) => [key, Number(value || 0)])),
    route_funding: fundingHealth,
    account_credit: creditHealth,
    route_receipts: receiptHealth,
    private_artifacts: Object.fromEntries(Object.entries(artifacts[0] || {}).map(([key, value]) => [key, Number(value || 0)])),
  }
  console.log(JSON.stringify(snapshot, null, 2))
  if (snapshot.route_receipts.receipt_anomaly_count || !snapshot.account_credit.healthy || snapshot.migrations < 42 || snapshot.provider_execution.acknowledgment_overdue_count || snapshot.provider_execution.acknowledgment_timed_out_count || snapshot.provider_execution.overdue_lease_count || snapshot.provider_execution.terminal_active_count || snapshot.provider_execution.funded_without_attempt_count || snapshot.provider_execution.delivery_deadline_overdue_count
    || snapshot.route_funding.exposure_anomaly_count || snapshot.route_funding.missing_step_count || snapshot.route_funding.proof_state_anomaly_count || snapshot.route_funding.payment_claim_anomaly_count
    || snapshot.verification_jobs.overdue_count || snapshot.verification_jobs.retained_suite_anomaly_count
    || snapshot.private_artifacts.missing_live_payload_count || snapshot.private_artifacts.purged_with_payload_count || snapshot.private_artifacts.overdue_purge_count
    || snapshot.webhook_outbox.failed_count || snapshot.webhook_outbox.overdue_count
    || snapshot.settlement_outbox.failed_count || snapshot.settlement_outbox.stuck_count) {
    throw new Error('Production operator preflight found an unhealthy routing or payment state')
  }
} finally { client.close() }
