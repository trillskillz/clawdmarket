import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeReputationScore } from '@/lib/reputation'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)

  try {
    const result = await (db as any).$client.execute(
      `SELECT id, name, description, capabilities, endpoint,
      owner_address, status, avg_rating, rating_count,
      created_at, version, benchmark_score, velocity_score,
      improvement_count
      FROM agents
      WHERE status = 'active'
        AND name NOT LIKE '%Seed%'
        AND name NOT LIKE '%Seeder%'
        AND name NOT LIKE 'API Agent%'
        AND name NOT LIKE 'Test%'
      ORDER BY created_at DESC
      LIMIT ?`,
      [limit]
    ).catch(() => null)

    const rows = result?.rows || []

    const tradeCountsResult = await (db as any).$client.execute(
      `SELECT agent_id,
      COUNT(*) as total_trades,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_trades
      FROM (
        SELECT seller_id as agent_id, status FROM trades
        UNION ALL
        SELECT buyer_id as agent_id, status FROM trades
      )
      GROUP BY agent_id`
    ).catch(() => null)

    const tradeMap = new Map<string, { total_trades: number; completed_trades: number }>(
      (tradeCountsResult?.rows || []).map((row: any) => [
        row.agent_id,
        {
          total_trades: Number(row.total_trades || 0),
          completed_trades: Number(row.completed_trades || 0),
        },
      ])
    )

    const agents = rows.map((row: any) => {
      const trades: { total_trades: number; completed_trades: number } = tradeMap.get(row.id) || { total_trades: 0, completed_trades: 0 }
      const avgRating = row.avg_rating ? Number(row.avg_rating) : null
      const ratingCount = Number(row.rating_count || 0)
      const benchmarkScore = row.benchmark_score ? Number(row.benchmark_score) : null
      const velocityScore = row.velocity_score ? Number(row.velocity_score) : null

      const isInternal = String(row.endpoint || '').includes('/api/internal/')
        || String(row.id || '').startsWith('clawdmarket_')
        || String(row.owner_address || '').toLowerCase() === 'clawdmarket-system'

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        capabilities: (() => {
          try { return JSON.parse(String(row.capabilities || '[]')) }
          catch { return [] }
        })(),
        ...(isInternal ? {} : { endpoint: row.endpoint }),
        owner_address: row.owner_address,
        status: row.status || 'active',
        avg_rating: avgRating,
        rating_count: ratingCount,
        created_at: row.created_at,
        version: row.version || 1,
        benchmark_score: benchmarkScore,
        velocity_score: velocityScore,
        improvement_count: Number(row.improvement_count || 0),
        completed_trades: trades.completed_trades,
        total_trades: trades.total_trades,
        reputation_score: computeReputationScore({
          benchmark_score: benchmarkScore,
          avg_rating: avgRating,
          rating_count: ratingCount,
          improvement_count: Number(row.improvement_count || 0),
          velocity_score: velocityScore,
          completed_trades: trades.completed_trades,
          total_trades: trades.total_trades,
        }),
      }
    })

    return NextResponse.json({
      agents,
      total: agents.length,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })

  } catch (err: any) {
    return NextResponse.json(
      { agents: [], total: 0, error: err.message },
      { status: 200 }
    )
  }
}
