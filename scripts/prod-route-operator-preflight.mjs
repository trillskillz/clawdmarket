import { createClient } from '@libsql/client'
import { inspectLegacyOwnerValues } from '../lib/legacy-owner-classification.mjs'

const url = process.env.TURSO_DATABASE_URL || ''
const authToken = process.env.TURSO_AUTH_TOKEN || ''
if (!url.startsWith('libsql://') || !authToken) throw new Error('Production Turso credentials are required')
const client = createClient({ url, authToken })
try {
  const read = async (sql) => (await client.execute(sql)).rows
  const [migrations, services, routes, orders, attempts, provider, missingAttempts, overdueDeliveries, webhooks, transfers, worker, legacyOwner] = await Promise.all([
    read('SELECT COUNT(*) AS count FROM _clawdmarket_migrations'),
    read('SELECT status AS state, COUNT(*) AS count FROM service_definitions GROUP BY status'),
    read('SELECT state, COUNT(*) AS count FROM route_plans GROUP BY state'),
    read('SELECT state, COUNT(*) AS count FROM service_orders GROUP BY state'),
    read('SELECT state, COUNT(*) AS count FROM service_execution_attempts GROUP BY state'),
    read(`SELECT
      COUNT(CASE WHEN a.state = 'accepted' AND a.lease_expires_at <= unixepoch() THEN 1 END) AS overdue_lease_count,
      COUNT(CASE WHEN a.state IN ('queued', 'accepted') AND (t.status != 'escrow_held' OR o.capacity_released_at IS NOT NULL) THEN 1 END) AS terminal_active_count
      FROM service_execution_attempts a JOIN service_orders o ON o.id = a.order_id JOIN trades t ON t.id = o.trade_id`),
    read(`SELECT COUNT(*) AS count FROM service_orders o
      JOIN service_definitions s ON s.id = o.service_id JOIN trades t ON t.id = o.trade_id
      LEFT JOIN service_execution_attempts a ON a.order_id = o.id
      WHERE s.provider_protocol = 'leased_v1' AND t.status = 'escrow_held'
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
  }
  console.log(JSON.stringify(snapshot, null, 2))
  if (snapshot.migrations < 32 || snapshot.provider_execution.overdue_lease_count || snapshot.provider_execution.terminal_active_count || snapshot.provider_execution.funded_without_attempt_count || snapshot.provider_execution.delivery_deadline_overdue_count
    || snapshot.webhook_outbox.failed_count || snapshot.webhook_outbox.overdue_count
    || snapshot.settlement_outbox.failed_count || snapshot.settlement_outbox.stuck_count) {
    throw new Error('Production operator preflight found an unhealthy routing or payment state')
  }
} finally { client.close() }
