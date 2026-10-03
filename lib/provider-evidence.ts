import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from './db'
import { capability_performance_events as events, trades } from './schema'
import type { CapabilityEvidence } from './provider-requirements'
import { REFERENCE_FLEET_MARKER } from './reference-fleet-manifest'

type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Revalidate money, review, identity and current ownership; buyer breadth is not verified independence. */
export async function backedCapabilityCounts(agentIds: string[], capabilities: string[], source: Source = db) {
  if (!agentIds.length || !capabilities.length) return new Map<string, { completions: number; buyers: number }>()
  const rows = await source.select({ agentId: events.seller_agent_id, capabilityId: events.capability_id,
    count: sql<number>`COUNT(DISTINCT ${trades.id})`, buyerCount: sql<number>`COUNT(DISTINCT ${trades.buyer_id})` })
    .from(events).innerJoin(trades, eq(trades.id, events.trade_id))
    .where(and(inArray(events.seller_agent_id, agentIds), inArray(events.capability_id, capabilities),
      eq(events.evidence_kind, 'buyer_accepted_completion'), eq(events.verification_method, 'buyer_review'),
      eq(trades.status, 'completed'), sql`${trades.seller_id} = ('user_agent_' || ${events.seller_agent_id})`,
      sql`${trades.buyer_id} <> ${trades.seller_id} AND ${trades.id} NOT GLOB 'trade_reference_*'`,
      sql`EXISTS (SELECT 1 FROM agents a WHERE a.id = ${events.seller_agent_id} AND instr(a.description, ${REFERENCE_FLEET_MARKER}) = 0)`,
      sql`NOT EXISTS (SELECT 1 FROM agent_owners o WHERE o.agent_id = ${events.seller_agent_id} AND o.user_id = ${trades.buyer_id})`,
      sql`NOT EXISTS (SELECT 1 FROM agent_owners seller_owner JOIN agent_owners buyer_owner ON seller_owner.user_id = buyer_owner.user_id
        WHERE seller_owner.agent_id = ${events.seller_agent_id} AND ('user_agent_' || buyer_owner.agent_id) = ${trades.buyer_id})`,
      sql`EXISTS (SELECT 1 FROM service_orders o WHERE o.id = ${events.service_order_id} AND o.trade_id = ${trades.id})`,
      sql`EXISTS (SELECT 1 FROM verification_results v JOIN trade_deliveries d ON d.id = v.delivery_id AND d.trade_id = v.trade_id
        WHERE v.trade_id = ${trades.id} AND v.method = 'buyer_review' AND v.status = 'passed')`,
      sql`((${trades.payment_rail} = 'ledger' AND EXISTS (SELECT 1 FROM transactions locked WHERE locked.reference_id = ${trades.id} AND locked.type = 'escrow_lock'))
        OR (${trades.payment_rail} IN ('mpp', 'evm') AND EXISTS (SELECT 1 FROM payment_receipts p WHERE p.trade_id = ${trades.id} AND p.payment_rail = ${trades.payment_rail})
        AND EXISTS (SELECT 1 FROM settlement_transfers s WHERE s.trade_id = ${trades.id} AND s.kind = 'seller_payout' AND s.status = 'confirmed' AND s.tx_hash IS NOT NULL)))`))
    .groupBy(events.seller_agent_id, events.capability_id)
  return new Map(rows.map((row) => [`${row.agentId}:${row.capabilityId}`, { completions: Number(row.count), buyers: Number(row.buyerCount) }]))
}

export function capabilityEvidence(sellerId: string, capabilities: string[], counts: Map<string, { completions: number; buyers: number }>): CapabilityEvidence[] {
  const agentId = sellerId.startsWith('user_agent_') ? sellerId.slice('user_agent_'.length) : null
  return capabilities.map((capability) => {
    const evidence = agentId ? counts.get(`${agentId}:${capability}`) : null
    return { capability_id: capability, accepted_completion_count: evidence?.completions ?? 0,
      distinct_buyer_count: evidence?.buyers ?? 0, measured_quality_score: null }
  })
}

export async function providerCapabilityEvidence(sellerId: string, capabilities: string[], source: Source = db) {
  const agentIds = sellerId.startsWith('user_agent_') ? [sellerId.slice('user_agent_'.length)] : []
  return capabilityEvidence(sellerId, capabilities, await backedCapabilityCounts(agentIds, capabilities, source))
}
