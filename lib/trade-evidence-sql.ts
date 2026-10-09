import { CAPABILITY_CYCLE_POLICY } from './capability-cycle-policy'

export type EvidenceTradeAlias = 't' | 'trades' | 'cycle_trade'

/** Current authoritative links only; unknown accounts remain distinct, unverified identities. */
export function tradePrincipalSql(party: `${EvidenceTradeAlias}.buyer_id` | `${EvidenceTradeAlias}.seller_id`) {
  return `COALESCE((SELECT principal_owner.user_id FROM agent_owners principal_owner
    WHERE ('user_agent_' || principal_owner.agent_id) = ${party}), ${party})`
}

/** Recorded backing, rechecked on reads; the legacy ledger branch retains lock semantics. */
export function financialBackingSql(trade: EvidenceTradeAlias) {
  return `((${trade}.payment_rail = 'ledger' AND EXISTS (SELECT 1 FROM transactions locked WHERE locked.reference_id = ${trade}.id AND locked.type = 'escrow_lock'))
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

/** Internal SQL only. The caller supplies a nonrecursive, currently backed edge predicate. */
export function boundedCycleExclusionSql(trade: EvidenceTradeAlias, edgeSql: string, capabilityEvents: boolean) {
  // CROSS JOIN keeps indexed outgoing-buyer probes before optional event lookup.
  return `NOT EXISTS (
    WITH RECURSIVE cycle_walk(principal, depth) AS (
      SELECT ${tradePrincipalSql(`${trade}.seller_id`)}, 0
      UNION
      SELECT ${tradePrincipalSql('cycle_trade.seller_id')}, cycle_walk.depth + 1
      FROM cycle_walk CROSS JOIN trades cycle_trade ON cycle_trade.buyer_id IN (
        SELECT cycle_walk.principal UNION
        SELECT ('user_agent_' || member.agent_id) FROM agent_owners member WHERE member.user_id = cycle_walk.principal)
      ${capabilityEvents ? 'CROSS JOIN capability_performance_events cycle_event ON cycle_event.trade_id = cycle_trade.id' : ''}
      WHERE cycle_walk.depth < ${CAPABILITY_CYCLE_POLICY.max_cycle_length - 1}
        AND ${tradePrincipalSql('cycle_trade.buyer_id')} = cycle_walk.principal
        AND ${edgeSql}
      LIMIT ${CAPABILITY_CYCLE_POLICY.max_search_states + 1}
    )
    SELECT count(*) FROM cycle_walk
    HAVING max(depth > 0 AND principal = ${tradePrincipalSql(`${trade}.buyer_id`)}) = 1
      OR count(*) > ${CAPABILITY_CYCLE_POLICY.max_search_states}
  )`
}
