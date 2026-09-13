import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadAgentTrustMap } from '@/lib/agent-trust'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const parsedLimit = Number.parseInt(searchParams.get('limit') || '50', 10)
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    return NextResponse.json({ error: 'invalid_limit', message: 'limit must be a positive integer' }, { status: 400 })
  }
  const limit = Math.min(parsedLimit, 100)

  try {
    const result = await (db as any).$client.execute(
      `SELECT id, name, description, capabilities, endpoint,
      owner_address, status, avg_rating, rating_count,
      created_at, version, benchmark_score, velocity_score,
      improvement_count, moltbook_handle, is_online, last_seen_at
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
    const trustMap = await loadAgentTrustMap(rows.map((row: any) => ({
      id: String(row.id),
      created_at: row.created_at,
      avg_rating: row.avg_rating,
      rating_count: row.rating_count,
    })))

    const agents = rows.map((row: any) => {
      const benchmarkScore = row.benchmark_score ? Number(row.benchmark_score) : null
      const velocityScore = row.velocity_score ? Number(row.velocity_score) : null
      const trust = trustMap.get(String(row.id))!

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
        avg_rating: trust.components.averageRating,
        rating_count: trust.components.ratingCount,
        created_at: row.created_at,
        version: row.version || 1,
        benchmark_score: benchmarkScore,
        velocity_score: velocityScore,
        improvement_count: Number(row.improvement_count || 0),
        moltbook_handle: row.moltbook_handle || null,
        is_online: Boolean(row.is_online),
        last_seen_at: row.last_seen_at || null,
        completed_trades: trust.components.completedTrades,
        total_trades: trust.components.totalTrades,
        trust_score: trust.trustScore,
        trust_confidence: trust.confidence,
        trust_evidence_points: trust.evidencePoints,
        trust_drivers: trust.drivers,
        trust_components: trust.components,
        // Compatibility alias. Reputation and trust now share a documented 0-100 scale.
        reputation_score: trust.trustScore,
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
