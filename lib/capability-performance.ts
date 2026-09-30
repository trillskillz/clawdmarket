import { and, eq, sql } from 'drizzle-orm'
import { db } from './db'
import { agents, agent_owners, capability_performance_events, payment_receipts, service_definitions, service_orders, settlement_transfers, transactions, verification_results } from './schema'
import { normalizeCapability } from './capabilities'
import { REFERENCE_FLEET_MARKER } from './reference-fleet-manifest'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Runs inside trade completion; an accepted service completion is evidence, not a quality score. */
export async function recordCapabilityCompletion(tx: Transaction, trade: { id: string; seller_id: string; buyer_id: string; payment_rail: string }) {
  if (trade.id.startsWith('trade_reference_') || trade.buyer_id === trade.seller_id || !trade.seller_id.startsWith('user_agent_')) return
  const agentId = trade.seller_id.slice('user_agent_'.length)
  const [agent] = await tx.select({ description: agents.description }).from(agents).where(eq(agents.id, agentId)).limit(1)
  if (!agent || agent.description.includes(REFERENCE_FLEET_MARKER)) return
  const [owner] = await tx.select({ userId: agent_owners.userId }).from(agent_owners).where(eq(agent_owners.agentId, agentId)).limit(1)
  if (owner?.userId === trade.buyer_id) return
  if (owner && trade.buyer_id.startsWith('user_agent_')) {
    const [buyerOwner] = await tx.select({ userId: agent_owners.userId }).from(agent_owners)
      .where(eq(agent_owners.agentId, trade.buyer_id.slice('user_agent_'.length))).limit(1)
    if (buyerOwner?.userId === owner.userId) return
  }
  const [order] = await tx.select({ id: service_orders.id, capabilities: service_definitions.capabilities })
    .from(service_orders).innerJoin(service_definitions, eq(service_orders.service_id, service_definitions.id))
    .where(eq(service_orders.trade_id, trade.id)).limit(1)
  if (!order) return
  const [accepted] = await tx.select({ id: verification_results.id }).from(verification_results)
    .where(and(eq(verification_results.trade_id, trade.id), eq(verification_results.method, 'buyer_review'), eq(verification_results.status, 'passed'), sql`${verification_results.delivery_id} IS NOT NULL`)).limit(1)
  if (!accepted) return
  if (trade.payment_rail === 'ledger') {
    const [locked] = await tx.select({ id: transactions.id }).from(transactions)
      .where(and(eq(transactions.reference_id, trade.id), eq(transactions.type, 'escrow_lock'))).limit(1)
    if (!locked) return
  } else if (trade.payment_rail === 'mpp' || trade.payment_rail === 'evm') {
    const [receipt] = await tx.select({ id: payment_receipts.id }).from(payment_receipts)
      .where(and(eq(payment_receipts.trade_id, trade.id), eq(payment_receipts.payment_rail, trade.payment_rail))).limit(1)
    const [payout] = await tx.select({ id: settlement_transfers.id }).from(settlement_transfers)
      .where(and(eq(settlement_transfers.trade_id, trade.id), eq(settlement_transfers.kind, 'seller_payout'), eq(settlement_transfers.status, 'confirmed'), sql`${settlement_transfers.tx_hash} IS NOT NULL`)).limit(1)
    if (!receipt || !payout) return
  } else return
  let declared: unknown
  try { declared = JSON.parse(order.capabilities) } catch { return }
  if (!Array.isArray(declared)) return
  const capabilities = [...new Set(declared.filter((value): value is string => typeof value === 'string').map(normalizeCapability).filter((value): value is string => Boolean(value)))].slice(0, 20)
  for (const capability of capabilities) {
    await tx.insert(capability_performance_events).values({
      id: crypto.randomUUID(), trade_id: trade.id, service_order_id: order.id, seller_agent_id: agentId,
      capability_id: capability, evidence_kind: 'buyer_accepted_completion', verification_method: 'buyer_review',
    }).onConflictDoNothing()
  }
}

export async function loadCapabilityPerformance(agentId: string) {
  const rows = await db.select({ capabilityId: capability_performance_events.capability_id, count: sql<number>`COUNT(*)` })
    .from(capability_performance_events).where(eq(capability_performance_events.seller_agent_id, agentId))
    .groupBy(capability_performance_events.capability_id)
  return rows.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId)).map((row) => ({
    capability_id: row.capabilityId, accepted_completion_count: Number(row.count),
    evidence_kind: 'buyer_accepted_completion' as const,
    confidence: Number(row.count) >= 20 ? 'high' as const : Number(row.count) >= 5 ? 'medium' as const : 'low' as const,
    measured_quality_score: null,
  }))
}
