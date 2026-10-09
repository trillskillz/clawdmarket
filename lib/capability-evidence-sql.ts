import { publicTradeWhereSql } from './public-trade-visibility'
import { REFERENCE_FLEET_MARKER } from './reference-fleet-manifest'
import { boundedCycleExclusionSql, financialBackingSql } from './trade-evidence-sql'
type TradeAlias = 't' | 'trades' | 'cycle_trade'
type EventAlias = 'e' | 'capability_performance_events' | 'cycle_event'

/** Nonrecursive eligibility shared by the observed completion and every graph edge. */
function backedCompletionSql(event: EventAlias, trade: TradeAlias) {
  return `${publicTradeWhereSql(trade)} AND ${event}.evidence_kind = 'buyer_accepted_completion' AND ${event}.verification_method = 'buyer_review'
    AND ${trade}.status = 'completed' AND ${trade}.seller_id = ('user_agent_' || ${event}.seller_agent_id)
    AND ${trade}.buyer_id <> ${trade}.seller_id AND ${trade}.id NOT GLOB 'trade_reference_*'
    AND EXISTS (SELECT 1 FROM agents evidence_agent WHERE evidence_agent.id = ${event}.seller_agent_id AND instr(evidence_agent.description, '${REFERENCE_FLEET_MARKER}') = 0)
    AND NOT EXISTS (SELECT 1 FROM agent_owners owner WHERE owner.agent_id = ${event}.seller_agent_id AND owner.user_id = ${trade}.buyer_id)
    AND NOT EXISTS (SELECT 1 FROM agent_owners seller_owner JOIN agent_owners buyer_owner ON seller_owner.user_id = buyer_owner.user_id
      WHERE seller_owner.agent_id = ${event}.seller_agent_id AND ('user_agent_' || buyer_owner.agent_id) = ${trade}.buyer_id)
    AND EXISTS (SELECT 1 FROM service_orders evidence_order WHERE evidence_order.id = ${event}.service_order_id AND evidence_order.trade_id = ${trade}.id AND evidence_order.payment_rail = ${trade}.payment_rail AND evidence_order.state = 'completed')
    AND EXISTS (SELECT 1 FROM verification_results review JOIN trade_deliveries delivery ON delivery.id = review.delivery_id AND delivery.trade_id = review.trade_id AND delivery.content_hash = review.content_hash
      WHERE review.trade_id = ${trade}.id AND review.method = 'buyer_review' AND review.status = 'passed')
    AND NOT EXISTS (SELECT 1 FROM route_plans evidence_route JOIN route_origins origin ON origin.route_id = evidence_route.id
      WHERE evidence_route.service_order_id = ${event}.service_order_id AND origin.cohort IN ('canary','demo','reference','nonproduction'))
    AND ${financialBackingSql(trade)}`
}

/** Fixed internal aliases only. Financial records and ownership are rechecked on every read. */
export function backedCapabilityEventSql(event: 'e' | 'capability_performance_events', trade: 't' | 'trades') {
  return `${backedCompletionSql(event, trade)} AND ${boundedCycleExclusionSql(trade, backedCompletionSql('cycle_event', 'cycle_trade'), true)}`
}

/** Compatibility verified=true filter means observed backed work, never measured skill. */
export const PUBLIC_AGENT_WORK_PROOF_SQL = `EXISTS (SELECT 1 FROM capability_performance_events e JOIN trades t ON t.id = e.trade_id
  WHERE e.seller_agent_id = agents.id AND ${backedCapabilityEventSql('e', 't')})`
