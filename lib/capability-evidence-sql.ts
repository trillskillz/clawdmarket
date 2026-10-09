import { REFERENCE_FLEET_MARKER } from './reference-fleet-manifest'
import { CAPABILITY_CYCLE_POLICY } from './capability-cycle-policy'
type TradeAlias = 't' | 'trades' | 'cycle_trade'
type EventAlias = 'e' | 'capability_performance_events' | 'cycle_event'

function principal(party: `${TradeAlias}.buyer_id` | `${TradeAlias}.seller_id`) {
  return `COALESCE((SELECT principal_owner.user_id FROM agent_owners principal_owner
    WHERE ('user_agent_' || principal_owner.agent_id) = ${party}), ${party})`
}

/** Nonrecursive eligibility shared by the observed completion and every graph edge. */
function backedCompletionSql(event: EventAlias, trade: TradeAlias) {
  return `${event}.evidence_kind = 'buyer_accepted_completion' AND ${event}.verification_method = 'buyer_review'
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
    AND ((${trade}.payment_rail = 'ledger' AND EXISTS (SELECT 1 FROM transactions locked WHERE locked.reference_id = ${trade}.id AND locked.type = 'escrow_lock'))
      OR (${trade}.payment_rail = 'credit' AND EXISTS (SELECT 1 FROM credit_entries credit_lock WHERE credit_lock.reference = ${trade}.id AND credit_lock.user_id = ${trade}.buyer_id AND credit_lock.kind = 'purchase'
          AND credit_lock.escrow_delta = round(${trade}.amount * 100) AND credit_lock.available_delta = -round(${trade}.total_cost * 100))
        AND EXISTS (SELECT 1 FROM credit_entries credit_release WHERE credit_release.reference = ${trade}.id AND credit_release.user_id = ${trade}.buyer_id AND credit_release.kind = 'settlement'
          AND credit_release.escrow_delta = -round(${trade}.amount * 100) AND credit_release.available_delta = 0)
        AND EXISTS (SELECT 1 FROM credit_entries credit_sale WHERE credit_sale.reference = ${trade}.id AND credit_sale.user_id = ${trade}.seller_id AND credit_sale.kind = 'sale'
          AND credit_sale.available_delta = round(${trade}.amount * 100) AND credit_sale.escrow_delta = 0))
      OR (${trade}.payment_rail IN ('mpp','evm') AND EXISTS (SELECT 1 FROM payment_receipts funding JOIN settlement_transfers payout ON payout.trade_id = funding.trade_id
        WHERE funding.trade_id = ${trade}.id AND funding.payment_rail = ${trade}.payment_rail AND funding.tx_hash IS NOT NULL
          AND round(funding.usd_value_at_payment * 100) = round(${trade}.total_cost * 100)
          AND payout.kind = 'seller_payout' AND payout.business_key = (${trade}.id || ':seller_payout') AND payout.status = 'confirmed' AND payout.tx_hash IS NOT NULL AND payout.confirmed_at IS NOT NULL
          AND payout.chain_id = funding.chain_id AND lower(payout.token_address) = lower(funding.token_address)
          AND round(payout.usd_amount * 100) = round(COALESCE(${trade}.seller_amount, ${trade}.amount) * 100))))`
}

/** Fixed internal aliases only. Financial records and ownership are rechecked on every read. */
export function backedCapabilityEventSql(event: 'e' | 'capability_performance_events', trade: 't' | 'trades') {
  // CROSS JOIN preserves indexed outgoing-account probes before event lookup.
  // A single aggregate consumes the bounded walk once, including exhaustion.
  return `${backedCompletionSql(event, trade)} AND NOT EXISTS (
    WITH RECURSIVE cycle_walk(principal, depth) AS (
      SELECT ${principal(`${trade}.seller_id`)}, 0
      UNION
      SELECT ${principal('cycle_trade.seller_id')}, cycle_walk.depth + 1
      FROM cycle_walk CROSS JOIN trades cycle_trade ON cycle_trade.buyer_id IN (
        SELECT cycle_walk.principal UNION
        SELECT ('user_agent_' || member.agent_id) FROM agent_owners member WHERE member.user_id = cycle_walk.principal)
      CROSS JOIN capability_performance_events cycle_event ON cycle_event.trade_id = cycle_trade.id
      WHERE cycle_walk.depth < ${CAPABILITY_CYCLE_POLICY.max_cycle_length - 1}
        AND ${principal('cycle_trade.buyer_id')} = cycle_walk.principal
        AND ${backedCompletionSql('cycle_event', 'cycle_trade')}
      LIMIT ${CAPABILITY_CYCLE_POLICY.max_search_states + 1}
    )
    SELECT count(*) FROM cycle_walk
    HAVING max(depth > 0 AND principal = ${principal(`${trade}.buyer_id`)}) = 1
      OR count(*) > ${CAPABILITY_CYCLE_POLICY.max_search_states}
  )`
}

/** Compatibility verified=true filter means observed backed work, never measured skill. */
export const PUBLIC_AGENT_WORK_PROOF_SQL = `EXISTS (SELECT 1 FROM capability_performance_events e JOIN trades t ON t.id = e.trade_id
  WHERE e.seller_agent_id = agents.id AND ${backedCapabilityEventSql('e', 't')})`
