import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadAgentTrustMap } from '@/lib/agent-trust'
import { reportInternalError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const parsedLimit = Number.parseInt(searchParams.get('limit') || String(DEFAULT_PAGE_SIZE), 10)
  const parsedPage = Number.parseInt(searchParams.get('page') || '1', 10)
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    return NextResponse.json({ error: 'invalid_limit', message: 'limit must be a positive integer' }, { status: 400 })
  }
  if (!Number.isInteger(parsedPage) || parsedPage < 1) {
    return NextResponse.json({ error: 'invalid_page', message: 'page must be a positive integer' }, { status: 400 })
  }
  const limit = Math.min(parsedLimit, MAX_PAGE_SIZE)
  const page = parsedPage
  const offset = (page - 1) * limit
  const search = searchParams.get('search')?.trim().slice(0, 200) || ''
  const verifiedOnly = searchParams.get('verified') === 'true'

  try {
    const conditions = [
      `status = 'active'`,
      `name NOT LIKE '%Seed%'`,
      `name NOT LIKE '%Seeder%'`,
      `name NOT LIKE 'API Agent%'`,
      `name NOT LIKE 'Test%'`,
    ]
    const filterArgs: string[] = []
    if (search) {
      conditions.push('(LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(capabilities) LIKE ?)')
      const term = `%${search.toLowerCase()}%`
      filterArgs.push(term, term, term)
    }
    if (verifiedOnly) {
      conditions.push(`LOWER(capabilities) LIKE '%:verified%'`)
    }
    const whereSql = conditions.join('\n        AND ')
    const client = (db as any).$client
    const [result, countResult] = await Promise.all([
      client.execute({ sql:
      `SELECT id, name, description, capabilities, endpoint,
      owner_address, status, avg_rating, rating_count,
      created_at, version, benchmark_score, velocity_score,
      improvement_count, moltbook_handle, is_online, last_seen_at
      FROM agents
      WHERE ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`, args: [...filterArgs, limit, offset] }),
      client.execute({
        sql: `SELECT COUNT(*) AS count FROM agents WHERE ${whereSql}`,
        args: filterArgs,
      }),
    ])

    const rows = result?.rows || []
    const total = Number(countResult?.rows?.[0]?.count || 0)
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
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      has_more: page * limit < total,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })

  } catch (err: any) {
    const errorId = reportInternalError('Agent directory query failed', err)
    return NextResponse.json(
      { agents: [], total: 0, error: 'temporarily_unavailable', error_id: errorId },
      { status: 200 }
    )
  }
}
