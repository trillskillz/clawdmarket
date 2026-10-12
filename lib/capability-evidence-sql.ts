import { REFERENCE_FLEET_MARKER } from './reference-fleet-manifest'
import { boundedCycleExclusionSql } from './trade-evidence-sql'
import { acceptedBackedTradeSql } from './reputation-evidence-sql'
import { balancedSqlAnd } from './sql-predicate'
type TradeAlias = 't' | 'trades' | 'cycle_trade'
type EventAlias = 'e' | 'capability_performance_events' | 'cycle_event'

// Both service offers and saved route requests are bounded to twenty capabilities.
// Keep array guards outside membership subqueries to limit cumulative depth.
// Invalid, non-array or oversized scope remains ineligible.
function capabilityArrayContainsSql(array: string, event: EventAlias) {
  const safe = `CASE WHEN json_valid(${array}) THEN ${array} ELSE '[]' END`
  return balancedSqlAnd([
    `json_type(${safe})='array'`, `json_array_length(${safe}) BETWEEN 1 AND 20`,
    `EXISTS (SELECT 1 FROM json_each(${safe}) capability_member WHERE capability_member.value=${event}.capability_id)`,
  ])
}

function frozenCapabilityContainsSql(event: EventAlias) {
  // Inspect paths in one safe document; do not nest array-selection CASEs
  // inside another JSON-validity CASE in every recursive graph edge.
  const document = `CASE WHEN json_valid(scope_order.execution_contract_json) THEN scope_order.execution_contract_json ELSE '{}' END`
  const requested = balancedSqlAnd([
    `json_type(${document}, '$.requested_capabilities')='array'`,
    `json_array_length(${document}, '$.requested_capabilities') BETWEEN 1 AND 20`,
    `EXISTS (SELECT 1 FROM json_each(${document}, '$.requested_capabilities') capability_member WHERE capability_member.value=${event}.capability_id)`,
  ])
  const legacy = balancedSqlAnd([
    `json_extract(${document}, '$.requested_capabilities') IS NULL`,
    `json_type(${document}, '$.capabilities')='array'`,
    `json_array_length(${document}, '$.capabilities')=1`,
    `json_extract(${document}, '$.capabilities[0]')=${event}.capability_id`,
  ])
  return `(${requested} OR ${legacy})`
}

/** Nonrecursive eligibility shared by the observed completion and every graph edge. */
function backedCompletionSql(event: EventAlias, trade: TradeAlias) {
  return balancedSqlAnd([publicTradeWhereSql(trade), `${event}.evidence_kind = 'buyer_accepted_completion'`, `${event}.verification_method = 'buyer_review'`,
    `${trade}.status = 'completed'`, `${trade}.seller_id = ('user_agent_' || ${event}.seller_agent_id)`,
    `${trade}.buyer_id <> ${trade}.seller_id`, `${trade}.id NOT GLOB 'trade_reference_*'`,
    `NOT EXISTS (SELECT 1 FROM reputation_events historical_event WHERE historical_event.trade_id=${trade}.id AND historical_event.historical_related=1)`,
    `EXISTS (SELECT 1 FROM agents evidence_agent WHERE evidence_agent.id = ${event}.seller_agent_id AND instr(evidence_agent.description, '${REFERENCE_FLEET_MARKER}') = 0)`,
    `NOT EXISTS (SELECT 1 FROM agent_owners owner WHERE owner.agent_id = ${event}.seller_agent_id AND owner.user_id = ${trade}.buyer_id)`,
    `NOT EXISTS (SELECT 1 FROM agent_owners seller_owner JOIN agent_owners buyer_owner ON seller_owner.user_id = buyer_owner.user_id
      WHERE seller_owner.agent_id = ${event}.seller_agent_id AND ('user_agent_' || buyer_owner.agent_id) = ${trade}.buyer_id)`,
    `EXISTS (SELECT 1 FROM service_orders evidence_order WHERE evidence_order.id = ${event}.service_order_id AND evidence_order.trade_id = ${trade}.id AND evidence_order.payment_rail = ${trade}.payment_rail AND evidence_order.state = 'completed')`,
    `NOT EXISTS (SELECT 1 FROM service_orders scope_order WHERE scope_order.id=${event}.service_order_id AND scope_order.execution_contract_json IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM route_plans scope_route WHERE scope_route.service_order_id=scope_order.id
        AND ${capabilityArrayContainsSql('scope_route.required_capabilities', event)})
      AND NOT ${frozenCapabilityContainsSql(event)})`,
    `EXISTS (SELECT 1 FROM verification_results review JOIN trade_deliveries delivery ON delivery.id = review.delivery_id AND delivery.trade_id = review.trade_id AND delivery.content_hash = review.content_hash
      WHERE review.trade_id = ${trade}.id AND review.method = 'buyer_review' AND review.status = 'passed')`,
    `NOT EXISTS (SELECT 1 FROM route_plans evidence_route JOIN route_origins origin ON origin.route_id = evidence_route.id
      WHERE evidence_route.service_order_id = ${event}.service_order_id AND origin.cohort IN ('canary','demo','reference','nonproduction'))`,
    acceptedBackedTradeSql(trade)])
}

/** Fixed internal aliases only. Financial records and ownership are rechecked on every read. */
export function backedCapabilityEventSql(event: 'e' | 'capability_performance_events', trade: 't' | 'trades') {
  return `${backedCompletionSql(event, trade)} AND ${boundedCycleExclusionSql(trade, backedCompletionSql('cycle_event', 'cycle_trade'), true)}`
}

/** Compatibility verified=true filter means observed backed work, never measured skill. */
export const PUBLIC_AGENT_WORK_PROOF_SQL = `EXISTS (SELECT 1 FROM capability_performance_events e
  JOIN trades t ON t.id = e.trade_id AND ${backedCapabilityEventSql('e', 't')}
  WHERE e.seller_agent_id = agents.id)`
import { publicTradeWhereSql } from './public-trade-visibility'
