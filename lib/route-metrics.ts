import { db } from './db'

type MetricRow = Record<string, unknown>

function count(value: unknown) { return Math.max(0, Number(value) || 0) }
function rate(numerator: number, denominator: number) { return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null }
function money(minor: number) { return (minor / 100).toFixed(2) }

/** Public aggregates. Capability evidence is emitted only for accepted, economically backed, non-reference work. */
export async function getRouteMetrics() {
  const result = await db.$client.execute({
    sql: `WITH route_evidence AS (
      SELECT r.id, r.state, r.service_order_id, r.candidates_json, o.price_minor,
        CASE WHEN r.state = 'completed' AND t.status IN ('completed', 'complete') AND EXISTS (
          SELECT 1 FROM capability_performance_events e
          WHERE e.trade_id = t.id AND e.service_order_id = o.id
            AND e.evidence_kind = 'buyer_accepted_completion'
        ) THEN 1 ELSE 0 END AS accepted_settled
      FROM route_plans r
      LEFT JOIN service_orders o ON o.id = r.service_order_id
      LEFT JOIN trades t ON t.id = o.trade_id
    ) SELECT
      COUNT(*) AS plans,
      COALESCE(SUM(CASE WHEN json_valid(candidates_json) THEN CASE WHEN json_array_length(candidates_json) > 0 THEN 1 ELSE 0 END ELSE 0 END), 0) AS viable_plans,
      COALESCE(SUM(CASE WHEN service_order_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS executions,
      COALESCE(SUM(CASE WHEN state = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
      COALESCE(SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
      COALESCE(SUM(accepted_settled), 0) AS accepted_settled_routes,
      COALESCE(SUM(CASE WHEN accepted_settled = 1 THEN price_minor ELSE 0 END), 0) AS assisted_gmv_minor
    FROM route_evidence`,
    args: [],
  })
  const row = (result.rows[0] || {}) as MetricRow
  const plans = count(row.plans)
  const executions = count(row.executions)
  const acceptedSettled = count(row.accepted_settled_routes)
  const assistedMinor = count(row.assisted_gmv_minor)
  return {
    contract_version: 1,
    currency: 'USD',
    plans,
    viable_plans: count(row.viable_plans),
    executions,
    cancelled: count(row.cancelled),
    failed: count(row.failed),
    accepted_settled_routes: acceptedSettled,
    planning_to_execution_rate: rate(executions, plans),
    execution_to_accepted_settlement_rate: rate(acceptedSettled, executions),
    assisted_routed_gmv: money(assistedMinor),
    autonomously_routed_gmv: '0.00',
    autonomy_status: 'not_implemented' as const,
    definitions: {
      assisted_routed_gmv: 'Sum of service prices, excluding fees, for completed route-linked orders with buyer-accepted, economically backed capability evidence. Reference and self-dealing trades have no such evidence.',
      autonomously_routed_gmv: 'Requires provider selection, dispatch, verification, and settlement by ClawdMarket. Current routes require buyer funding and provider delivery outside the router.',
    },
    updated_at: new Date().toISOString(),
  }
}
