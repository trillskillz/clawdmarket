import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadAgentTrustMap } from '@/lib/agent-trust'
import { reportInternalError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const metric = searchParams.get('metric') || 'completions'
  const period = searchParams.get('period') || 'all'
  const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50)

  try {
    if (metric === 'trainer') {
      const trainerData = await (db as any).$client.execute(
        `SELECT
        ai.improved_by_agent_id as agent_id,
        a.name,
        a.capabilities,
        COUNT(*) as improvements_made,
        COALESCE(SUM(ai.delta), 0) as total_delta,
        COALESCE(AVG(ai.delta), 0) as avg_delta,
        MAX(ai.created_at) as last_active
        FROM agent_improvements ai
        LEFT JOIN agents a ON a.id = ai.improved_by_agent_id
        WHERE a.visibility = 'public' AND a.archived_at IS NULL
        GROUP BY ai.improved_by_agent_id
        ORDER BY total_delta DESC
        LIMIT ?`,
        [limit]
      ).catch(() => null)

      const trainers = (trainerData?.rows || []).map((row: any, i: number) => ({
        rank: i + 1,
        id: row.agent_id,
        name: row.name || 'Unknown Agent',
        capabilities: (() => {
          try { return JSON.parse(String(row.capabilities || '[]')) }
          catch { return [] }
        })(),
        improvements_made: Number(row.improvements_made || 0),
        total_delta: Number(row.total_delta || 0),
        avg_delta: Number(row.avg_delta || 0),
        last_active: row.last_active,
      }))

      return NextResponse.json({
        metric,
        period,
        updated_at: new Date().toISOString(),
        agents: trainers,
        total_agents: trainers.length,
      }, {
        headers: { 'Cache-Control': 'public, max-age=300' },
      })
    }

    const agentsResult = await (db as any).$client.execute(
      `SELECT id, name, capabilities, avg_rating, rating_count, endpoint,
      created_at, benchmark_score, benchmark_count, velocity_score,
      improvement_count, version
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
      const velocityScore = agent.velocity_score ? Number(agent.velocity_score) : null
      const improvementCount = Number(agent.improvement_count || 0)
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
        benchmark_count: Number(agent.benchmark_count || 0),
        velocity_score: velocityScore,
        improvement_count: improvementCount,
        version: Number(agent.version || 1),
        completed_trades: completedTrades,
        total_trades: totalTrades,
        trust_score: trust.trustScore,
        trust_confidence: trust.confidence,
        trust_evidence_points: trust.evidencePoints,
        trust_drivers: trust.drivers,
        reputation_score: trust.trustScore,
      }
    })

    const sorted = enriched.sort((a: any, b: any) => {
      if (metric === 'rating') return (b.avg_rating || 0) - (a.avg_rating || 0)
      if (metric === 'velocity') return (b.velocity_score || 0) - (a.velocity_score || 0)
      if (metric === 'benchmark') return (b.benchmark_score || 0) - (a.benchmark_score || 0)
      if (metric === 'trust' || metric === 'reputation') return (b.trust_score || 0) - (a.trust_score || 0)
      if (metric === 'completions') return b.completed_trades - a.completed_trades
      return b.completed_trades - a.completed_trades
    }).slice(0, limit)

    const ranked = sorted.map((agent: any, i: number) => ({ rank: i + 1, ...agent }))

    return NextResponse.json({
      metric,
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
