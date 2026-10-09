import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from './db'
import { capability_performance_events as events, trades } from './schema'
import type { CapabilityEvidence } from './provider-requirements'
import { backedCapabilityEventSql } from './capability-evidence-sql'

type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Revalidate money, review, identity and current ownership; buyer breadth is not verified independence. */
export async function backedCapabilityCounts(agentIds: string[], capabilities: string[], source: Source = db) {
  if (!agentIds.length || !capabilities.length) return new Map<string, { completions: number; buyers: number }>()
  const rows = await source.select({ agentId: events.seller_agent_id, capabilityId: events.capability_id,
    count: sql<number>`COUNT(DISTINCT ${trades.id})`, buyerCount: sql<number>`COUNT(DISTINCT COALESCE((SELECT buyer_owner.user_id FROM agent_owners buyer_owner WHERE ('user_agent_' || buyer_owner.agent_id) = ${trades.buyer_id}), ${trades.buyer_id}))` })
    .from(events).innerJoin(trades, eq(trades.id, events.trade_id))
    .where(and(inArray(events.seller_agent_id, agentIds), inArray(events.capability_id, capabilities),
      sql.raw(backedCapabilityEventSql('capability_performance_events', 'trades'))))
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
