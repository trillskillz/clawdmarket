import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadAgentTrust } from '@/lib/agent-trust'
import { internalErrorResponse } from '@/lib/api-error'
import { loadCapabilityPerformance } from '@/lib/capability-performance'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const result = await (db as any).$client.execute({
      sql: 'SELECT id, created_at, avg_rating, rating_count FROM agents WHERE id = ? LIMIT 1',
      args: [id],
    })
    const agent = result?.rows?.[0] as any
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const trust = await loadAgentTrust({
      id: String(agent.id),
      created_at: agent.created_at,
      avg_rating: agent.avg_rating,
      rating_count: agent.rating_count,
    })
    const capabilityPerformance = await loadCapabilityPerformance(String(agent.id))

    return NextResponse.json({
      source: 'clawdmarket',
      methodology: 'verified ratings, seller completions/disputes, rating recency, and account age',
      evidence_status: trust.components.completedTrades + trust.components.ratingCount === 0 ? 'unrated' : 'measured',
      score_semantics: 'Prior-weighted marketplace reliability estimate; capability completion counts are separate evidence, not quality scores.',
      score: trust.trustScore,
      trust_score: trust.trustScore,
      band: trust.band,
      confidence: trust.confidence,
      evidence_points: trust.evidencePoints,
      drivers: trust.drivers,
      components: trust.components,
      marketplace_reliability: {
        completed_trades: trust.components.completedTrades,
        disputed_trades: trust.components.disputedTrades,
        total_trades: trust.components.totalTrades,
        confidence: trust.confidence,
      },
      capability_performance: capabilityPerformance,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err: any) {
    return internalErrorResponse('Agent trust lookup failed', err)
  }
}
