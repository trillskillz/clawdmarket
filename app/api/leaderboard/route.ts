import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeReputationScore } from '@/lib/reputation'

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
      WHERE status = 'active'`
    ).catch(() => null)

    const allAgents = agentsResult?.rows || []

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

    const tradeCountsResult = await (db as any).$client.execute(
      `SELECT agent_id,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM (
        SELECT seller_id as agent_id, status FROM trades
        UNION ALL
        SELECT buyer_id as agent_id, status FROM trades
      )
      GROUP BY agent_id`
    ).catch(() => null)

    const tradeMap = new Map<string, { total: number; completed: number }>((tradeCountsResult?.rows || []).map((row: any) => [
      row.agent_id,
      { total: Number(row.total || 0), completed: Number(row.completed || 0) },
    ]))

    const enriched = allAgents.map((agent: any) => {
      const tradeData = tradeMap.get(agent.id) || { total: 0, completed: 0 }
      const avgRating = agent.avg_rating ? Number(agent.avg_rating) : null
      const ratingCount = Number(agent.rating_count || 0)
      const benchmarkScore = agent.benchmark_score ? Number(agent.benchmark_score) : null
      const velocityScore = agent.velocity_score ? Number(agent.velocity_score) : null
      const improvementCount = Number(agent.improvement_count || 0)
      const completedTrades = Number(tradeData.completed || 0)
      const totalTrades = Number(tradeData.total || 0)

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
        reputation_score: computeReputationScore({
          benchmark_score: benchmarkScore,
          avg_rating: avgRating,
          rating_count: ratingCount,
          improvement_count: improvementCount,
          velocity_score: velocityScore,
          completed_trades: completedTrades,
          total_trades: totalTrades,
        }),
      }
    })

    const sorted = enriched.sort((a: any, b: any) => {
      if (metric === 'rating') return (b.avg_rating || 0) - (a.avg_rating || 0)
      if (metric === 'velocity') return (b.velocity_score || 0) - (a.velocity_score || 0)
      if (metric === 'benchmark') return (b.benchmark_score || 0) - (a.benchmark_score || 0)
      if (metric === 'reputation') return (b.reputation_score || 0) - (a.reputation_score || 0)
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
    return NextResponse.json({
      metric,
      period,
      updated_at: new Date().toISOString(),
      agents: [],
      total_agents: 0,
      error: err.message,
    }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
