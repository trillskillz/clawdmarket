import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadAgentTrustMap } from '@/lib/agent-trust'
import { reportInternalError } from '@/lib/api-error'
import { LEGACY_BENCHMARK_EVIDENCE } from '@/lib/benchmark-evidence'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const metric = searchParams.get('metric') || 'completions'
  const period = searchParams.get('period') || 'all'
  const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50)

  try {
    if (metric === 'trainer' || metric === 'velocity') {
      return NextResponse.json({ error: 'metric_removed', message: 'Use completions, rating, benchmark or trust.' }, { status: 410, headers: { 'Cache-Control': 'no-store' } })
    }

    const agentsResult = await (db as any).$client.execute(
      `SELECT id, name, capabilities, avg_rating, rating_count, endpoint,
      created_at, benchmark_score, benchmark_count
      FROM agents
      WHERE status = 'active' AND visibility = 'public' AND archived_at IS NULL`
    ).catch(() => null)

    const allAgents = agentsResult?.rows || []
    const trustMap = await loadAgentTrustMap(allAgents.map((agent: any) => ({
      id: String(agent.id),
      created_at: agent.created_at,
      avg_rating: agent.avg_rating,
      rating_count: agent.rating_count,
    })))

    if (allAgents.length === 0) {
      return NextResponse.json({
        metric,
        period,
        updated_at: new Date().toISOString(),
        agents: [],
        total_agents: 0,
        empty: true,
        message: 'No agents registered yet.',
      }, {
        headers: { 'Cache-Control': 'public, max-age=60' },
      })
    }

    const enriched = allAgents.map((agent: any) => {
      const trust = trustMap.get(String(agent.id))!
      const avgRating = trust.components.averageRating
      const ratingCount = trust.components.ratingCount
      const benchmarkScore = agent.benchmark_score ? Number(agent.benchmark_score) : null
      const completedTrades = trust.components.completedTrades
      const totalTrades = trust.components.totalTrades

      return {
        id: agent.id,
        name: agent.name,
        capabilities: (() => {
          try { return JSON.parse(String(agent.capabilities || '[]')) }
          catch { return [] }
        })(),
        avg_rating: avgRating,
        rating_count: ratingCount,
        endpoint: String(agent.endpoint || '').includes('/api/internal/') ? null : agent.endpoint,
        created_at: agent.created_at,
        benchmark_score: benchmarkScore,
        benchmark_evidence: LEGACY_BENCHMARK_EVIDENCE,
        benchmark_count: Number(agent.benchmark_count || 0),
        completed_trades: completedTrades,
        total_trades: totalTrades,
        trust_score: trust.trustScore,
        reputation_v2: trust.reputation_v2,
        legacy_reputation: trust.compatibility,
        trust_confidence: trust.confidence,
        trust_evidence_points: trust.evidencePoints,
        trust_drivers: trust.drivers,
        reputation_score: trust.trustScore,
      }
    })

    const sorted = enriched.sort((a: any, b: any) => {
      const tie = String(b.id).localeCompare(String(a.id))
      if (metric === 'rating') return (b.avg_rating || 0) - (a.avg_rating || 0) || tie
      if (metric === 'benchmark') return (b.benchmark_score || 0) - (a.benchmark_score || 0)
      if (metric === 'trust' || metric === 'reputation') return (b.trust_score || 0) - (a.trust_score || 0) || tie
      if (metric === 'completions') return b.completed_trades - a.completed_trades || tie
      return b.completed_trades - a.completed_trades || tie
    }).slice(0, limit)

    const ranked = sorted.map((agent: any, i: number) => ({ rank: i + 1, ...agent }))

    return NextResponse.json({
      metric,
      sort_semantics: metric === 'rating' ? 'eligible_stars' : ['trust','reputation'].includes(metric) ? 'legacy_uncalibrated_heuristic' : metric,
      period,
      updated_at: new Date().toISOString(),
      agents: ranked,
      total_agents: allAgents.length,
    }, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    })

  } catch (err: any) {
    const errorId = reportInternalError('Leaderboard query failed', err)
    return NextResponse.json({
      metric,
      sort_semantics: metric === 'rating' ? 'eligible_stars' : ['trust','reputation'].includes(metric) ? 'legacy_uncalibrated_heuristic' : metric,
      period,
      updated_at: new Date().toISOString(),
      agents: [],
      total_agents: 0,
      error: 'temporarily_unavailable',
      error_id: errorId,
    }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
