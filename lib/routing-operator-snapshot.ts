import 'server-only'
import { db } from '@/lib/db'
import { routeExecutionEnabled, routePlanningEnabled, reusableServiceWritesEnabled, routingCanaryConfigured, workflowPlanningEnabled } from '@/lib/routing-feature-flags'
import { inspectWebhookDeliveryHealth } from '@/lib/webhook-delivery'
import { inspectSettlementHealth } from '@/lib/settlement-monitoring'
import { inspectWorkerHeartbeat } from '@/lib/worker-heartbeats'
import { PROVIDER_ACKNOWLEDGMENT_TIMEOUT_SECONDS } from '@/lib/provider-acknowledgment'

function countByState(rows: readonly Record<string, unknown>[]) {
  return Object.fromEntries(rows.map((row) => [String(row.state), Number(row.count || 0)]))
}

/** Aggregate-only operator snapshot. No account, endpoint, payload, or credential values leave this function. */
export async function getRoutingOperatorSnapshot() {
  const client = db.$client
  const [migrations, services, routes, orders, attempts, attemptHealth, missingAttempts, overdueDeliveries, webhooks, settlement, cron, verificationHealth] = await Promise.all([
    client.execute('SELECT id, applied_at FROM _clawdmarket_migrations ORDER BY applied_at DESC, id DESC LIMIT 8'),
    client.execute('SELECT status AS state, COUNT(*) AS count FROM service_definitions GROUP BY status'),
    client.execute('SELECT state, COUNT(*) AS count FROM route_plans GROUP BY state'),
    client.execute('SELECT state, COUNT(*) AS count FROM service_orders GROUP BY state'),
    client.execute('SELECT state, COUNT(*) AS count FROM service_execution_attempts GROUP BY state'),
    client.execute(`SELECT
      COUNT(CASE WHEN a.state = 'queued' AND COALESCE(a.acknowledgment_due_at, a.created_at + ${PROVIDER_ACKNOWLEDGMENT_TIMEOUT_SECONDS}) <= unixepoch()
        AND t.status = 'escrow_held' AND o.state = 'funded' AND o.capacity_released_at IS NULL THEN 1 END) AS acknowledgment_overdue_count,
      COUNT(CASE WHEN a.state = 'acknowledgment_timed_out' AND t.status = 'escrow_held'
        AND o.state = 'funded' AND o.capacity_released_at IS NULL THEN 1 END) AS acknowledgment_timed_out_count,
      COUNT(CASE WHEN a.state = 'accepted' AND a.lease_expires_at <= unixepoch() THEN 1 END) AS overdue_lease_count,
      COUNT(CASE WHEN a.state IN ('queued', 'accepted') AND (t.status != 'escrow_held' OR o.capacity_released_at IS NOT NULL) THEN 1 END) AS terminal_active_count
      FROM service_execution_attempts a
      JOIN service_orders o ON o.id = a.order_id
      JOIN trades t ON t.id = o.trade_id`),
    client.execute(`SELECT COUNT(*) AS count FROM service_orders o
      JOIN service_definitions s ON s.id = o.service_id
      JOIN trades t ON t.id = o.trade_id
      LEFT JOIN service_execution_attempts a ON a.order_id = o.id
      WHERE (CASE WHEN o.execution_contract_json IS NULL THEN s.provider_protocol
        WHEN json_valid(o.execution_contract_json) THEN json_extract(o.execution_contract_json, '$.provider_protocol') END) = 'leased_v1' AND t.status = 'escrow_held'
        AND o.state IN ('funded', 'executing') AND o.capacity_released_at IS NULL AND a.id IS NULL`),
    client.execute(`SELECT COUNT(*) AS count FROM route_plans r
      JOIN service_orders o ON o.id = r.service_order_id
      JOIN trades t ON t.id = o.trade_id
      WHERE t.status = 'escrow_held' AND o.state IN ('funded', 'executing')
        AND o.capacity_released_at IS NULL AND r.deadline_seconds IS NOT NULL
        AND unixepoch(t.funded_at) + r.deadline_seconds <= unixepoch()`),
    inspectWebhookDeliveryHealth(),
    inspectSettlementHealth(client),
    inspectWorkerHeartbeat('webhooks', 5),
    client.execute(`SELECT COUNT(CASE WHEN state = 'pending' THEN 1 END) AS pending_count,
      COUNT(CASE WHEN state = 'pending' AND expires_at <= unixepoch() THEN 1 END) AS overdue_count,
      COUNT(CASE WHEN state != 'pending' AND (suite_ciphertext IS NOT NULL OR suite_nonce IS NOT NULL) THEN 1 END) AS retained_suite_anomaly_count
      FROM verification_jobs`),
  ])
  return {
    checked_at: new Date().toISOString(),
    flags: {
      reusable_service_writes: reusableServiceWritesEnabled(),
      route_planning: routePlanningEnabled(),
      route_execution: routeExecutionEnabled(),
      workflow_planning: workflowPlanningEnabled(),
      scoped_route_canary: routingCanaryConfigured(),
    },
    migrations: migrations.rows.map((row) => ({ id: String(row.id), applied_at: String(row.applied_at) })),
    usage: {
      services: countByState(services.rows), routes: countByState(routes.rows),
      orders: countByState(orders.rows), provider_attempts: countByState(attempts.rows),
    },
    provider_execution: {
      acknowledgment_overdue_count: Number(attemptHealth.rows[0]?.acknowledgment_overdue_count || 0),
      acknowledgment_timed_out_count: Number(attemptHealth.rows[0]?.acknowledgment_timed_out_count || 0),
      overdue_lease_count: Number(attemptHealth.rows[0]?.overdue_lease_count || 0),
      terminal_active_count: Number(attemptHealth.rows[0]?.terminal_active_count || 0),
      funded_without_attempt_count: Number(missingAttempts.rows[0]?.count || 0),
      delivery_deadline_overdue_count: Number(overdueDeliveries.rows[0]?.count || 0),
    },
    outboxes: { webhook: webhooks, settlement },
    verification_jobs: { pending_count: Number(verificationHealth.rows[0]?.pending_count || 0), overdue_count: Number(verificationHealth.rows[0]?.overdue_count || 0),
      retained_suite_anomaly_count: Number(verificationHealth.rows[0]?.retained_suite_anomaly_count || 0) },
    workers: { webhooks: cron },
  }
}
