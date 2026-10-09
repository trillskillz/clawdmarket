import { publicTradeWhereSql } from './public-trade-visibility'
import { REFERENCE_FLEET_MARKER } from './reference-fleet-manifest'
import { boundedCycleExclusionSql, financialBackingSql, tradePrincipalSql, type EvidenceTradeAlias } from './trade-evidence-sql'

/** Positive and adverse observations share identity/cohort exclusions, never cycle filtering. */
export function eligibleReputationTradeSql(trade: EvidenceTradeAlias) {
  return `${publicTradeWhereSql(trade)} AND ${trade}.buyer_id <> ${trade}.seller_id AND ${trade}.id NOT GLOB 'trade_reference_*'
    AND ${tradePrincipalSql(`${trade}.buyer_id`)} <> ${tradePrincipalSql(`${trade}.seller_id`)}
    AND NOT EXISTS (SELECT 1 FROM agents ref WHERE (('user_agent_' || ref.id) IN (${trade}.seller_id, ${trade}.buyer_id) OR ref.id IN (${trade}.seller_id, ${trade}.buyer_id))
      AND instr(ref.description, '${REFERENCE_FLEET_MARKER}') > 0)
    AND NOT EXISTS (SELECT 1 FROM service_orders cohort_order JOIN route_plans cohort_route ON cohort_route.service_order_id = cohort_order.id
      JOIN route_origins origin ON origin.route_id = cohort_route.id
      WHERE cohort_order.trade_id = ${trade}.id AND origin.cohort IN ('canary','demo','reference','nonproduction'))`
}

function acceptedBackedTradeSql(trade: EvidenceTradeAlias) {
  return `${trade}.status IN ('completed','complete') AND ${trade}.amount > 0 AND ${eligibleReputationTradeSql(trade)}
    AND EXISTS (SELECT 1 FROM verification_results review JOIN trade_deliveries delivery
      ON delivery.id = review.delivery_id AND delivery.trade_id = review.trade_id AND delivery.content_hash = review.content_hash
      WHERE review.trade_id = ${trade}.id AND review.method = 'buyer_review' AND review.status = 'passed')
    AND NOT EXISTS (SELECT 1 FROM service_orders checked_order WHERE checked_order.trade_id = ${trade}.id
      AND (checked_order.state <> 'completed' OR checked_order.payment_rail <> ${trade}.payment_rail))
    AND NOT EXISTS (SELECT 1 FROM transactions refunded WHERE refunded.reference_id = ${trade}.id
      AND refunded.type = 'escrow_refund' AND refunded.amount > 0)
    AND NOT EXISTS (SELECT 1 FROM settlement_transfers refund WHERE refund.trade_id = ${trade}.id
      AND refund.kind = 'buyer_refund' AND refund.status IN ('submitted','confirmed'))
    AND ${financialBackingSql(trade)}
    AND (${trade}.payment_rail <> 'ledger' OR (EXISTS (SELECT 1 FROM transactions locked WHERE locked.reference_id = ${trade}.id AND locked.type = 'escrow_lock'
      AND locked.from_user_id = ${trade}.buyer_id AND round(locked.amount * 100) = round(${trade}.amount * 100))
      AND EXISTS (SELECT 1 FROM transactions released WHERE released.reference_id = ${trade}.id AND released.type = 'escrow_release'
      AND released.from_user_id = ${trade}.buyer_id AND released.to_user_id = ${trade}.seller_id AND round(released.amount * 100) = round(${trade}.amount * 100))))`
}

/** Manual marketplace work also qualifies; no capability claim or service event is inferred. */
export function backedReputationTradeSql(trade: EvidenceTradeAlias) {
  return `${acceptedBackedTradeSql(trade)} AND ${boundedCycleExclusionSql(trade, acceptedBackedTradeSql('cycle_trade'), false)}`
}

/** Internal restrictions only; no private principal or rating identity leaves the aggregate. */
export function rankedBuyerFeedbackSql(restriction: string) {
  return `SELECT r.id, CASE WHEN t.seller_id GLOB 'user_agent_*' THEN substr(t.seller_id, 12) ELSE t.seller_id END AS rated_id,
      r.score, r.created_at,
      row_number() OVER (PARTITION BY CASE WHEN t.seller_id GLOB 'user_agent_*' THEN substr(t.seller_id, 12) ELSE t.seller_id END,
        ${tradePrincipalSql('t.buyer_id')} ORDER BY datetime(r.created_at) DESC, r.id DESC) AS feedback_rank
    FROM ratings r JOIN trades t ON t.id = r.trade_id
    WHERE ${restriction} AND r.rater_id = t.buyer_id
      AND (r.rated_id = t.seller_id OR EXISTS (SELECT 1 FROM agents rated_agent
        WHERE (rated_agent.id = r.rated_id AND ('user_agent_' || rated_agent.id) = t.seller_id)
          OR (rated_agent.id = t.seller_id AND r.rated_id = ('user_agent_' || rated_agent.id))))
      AND r.score BETWEEN 1 AND 5 AND r.score = CAST(r.score AS INTEGER)
      AND datetime(r.created_at) IS NOT NULL AND datetime(r.created_at) <= datetime('now')
      AND ${backedReputationTradeSql('t')}`
}

export function listingFeedbackAggregateSql(aggregate: 'AVG(score)' | 'COUNT(*)') {
  return `(SELECT ${aggregate} FROM (${rankedBuyerFeedbackSql('t.seller_id = listings.seller_id')}) WHERE feedback_rank = 1)`
}

export const LISTING_BACKED_BUYER_COUNT_SQL = `(SELECT COUNT(DISTINCT ${tradePrincipalSql('t.buyer_id')})
  FROM trades t WHERE t.seller_id = listings.seller_id AND ${backedReputationTradeSql('t')})`
