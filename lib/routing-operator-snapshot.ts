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
  const [migrations, services, routes, orders, attempts, webhooks, settlement, cron] = await Promise.all([
    client.execute('SELECT id, applied_at FROM _clawdmarket_migrations ORDER BY applied_at DESC, id DESC LIMIT 8'),
    client.execute('SELECT status AS state, COUNT(*) AS count FROM service_definitions GROUP BY status'),
    client.execute('SELECT state, COUNT(*) AS count FROM route_plans GROUP BY state'),
    client.execute('SELECT state, COUNT(*) AS count FROM service_orders GROUP BY state'),
    client.execute('SELECT state, COUNT(*) AS count FROM service_execution_attempts GROUP BY state'),
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
    outboxes: { webhook: webhooks, settlement },
    workers: { webhooks: cron },
  }
}
