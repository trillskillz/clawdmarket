import 'server-only'
import { db } from '@/lib/db'
import { routeExecutionEnabled, routePlanningEnabled, reusableServiceWritesEnabled, workflowPlanningEnabled } from '@/lib/routing-feature-flags'
import { inspectWebhookDeliveryHealth } from '@/lib/webhook-delivery'
import { inspectSettlementHealth } from '@/lib/settlement-monitoring'
import { inspectWorkerHeartbeat } from '@/lib/worker-heartbeats'

function countByState(rows: readonly Record<string, unknown>[]) {
  return Object.fromEntries(rows.map((row) => [String(row.state), Number(row.count || 0)]))
}

/** Aggregate-only operator snapshot. No account, endpoint, payload, or credential values leave this function. */
export async function getRoutingOperatorSnapshot() {
  const client = db.$client
  const [migrations, services, routes, orders, attempts, attemptHealth, missingAttempts, webhooks, settlement, cron] = await Promise.all([
    client.execute('SELECT id, applied_at FROM _clawdmarket_migrations ORDER BY applied_at DESC, id DESC LIMIT 8'),
    client.execute('SELECT status AS state, COUNT(*) AS count FROM service_definitions GROUP BY status'),
    client.execute('SELECT state, COUNT(*) AS count FROM route_plans GROUP BY state'),
    client.execute('SELECT state, COUNT(*) AS count FROM service_orders GROUP BY state'),
    client.execute('SELECT state, COUNT(*) AS count FROM service_execution_attempts GROUP BY state'),
    client.execute(`SELECT
      COUNT(CASE WHEN a.state = 'accepted' AND a.lease_expires_at <= unixepoch() THEN 1 END) AS overdue_lease_count,
      COUNT(CASE WHEN a.state IN ('queued', 'accepted') AND (t.status != 'escrow_held' OR o.capacity_released_at IS NOT NULL) THEN 1 END) AS terminal_active_count
      FROM service_execution_attempts a
      JOIN service_orders o ON o.id = a.order_id
      JOIN trades t ON t.id = o.trade_id`),
    client.execute(`SELECT COUNT(*) AS count FROM service_orders o
      JOIN service_definitions s ON s.id = o.service_id
      JOIN trades t ON t.id = o.trade_id
      LEFT JOIN service_execution_attempts a ON a.order_id = o.id
      WHERE s.provider_protocol = 'leased_v1' AND t.status = 'escrow_held'
        AND o.state IN ('funded', 'executing') AND o.capacity_released_at IS NULL AND a.id IS NULL`),
    inspectWebhookDeliveryHealth(),
    inspectSettlementHealth(client),
    inspectWorkerHeartbeat('webhooks', 5),
  ])
  return {
    checked_at: new Date().toISOString(),
    flags: {
      reusable_service_writes: reusableServiceWritesEnabled(),
      route_planning: routePlanningEnabled(),
      route_execution: routeExecutionEnabled(),
      workflow_planning: workflowPlanningEnabled(),
    },
    migrations: migrations.rows.map((row) => ({ id: String(row.id), applied_at: String(row.applied_at) })),
    usage: {
      services: countByState(services.rows), routes: countByState(routes.rows),
      orders: countByState(orders.rows), provider_attempts: countByState(attempts.rows),
    },
    provider_execution: {
      overdue_lease_count: Number(attemptHealth.rows[0]?.overdue_lease_count || 0),
      terminal_active_count: Number(attemptHealth.rows[0]?.terminal_active_count || 0),
      funded_without_attempt_count: Number(missingAttempts.rows[0]?.count || 0),
    },
    outboxes: { webhook: webhooks, settlement },
    workers: { webhooks: cron },
  }
}
