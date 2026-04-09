import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Simple in-memory cache with 5 minute TTL
const cache = new Map<string, { data: any; expires: number }>()

function getCached(key: string): any | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    cache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key: string, data: any) {
  cache.set(key, { data, expires: Date.now() + 5 * 60 * 1000 })
}

function getBand(score: number): string {
  if (score > 80) return 'HIGHLY TRUSTED'
  if (score > 60) return 'TRUSTED'
  if (score > 40) return 'MODERATE'
  if (score > 20) return 'LOW TRUST'
  return 'UNVERIFIED'
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Check cache first
    const cached = getCached(`trust:${id}`)
    if (cached) return NextResponse.json(cached)

    const client = (db as any).$client

    // Fetch agent data
    const agentRes = await client.execute({
      sql: `SELECT name, avg_rating, rating_count, improvement_count FROM agents WHERE id = ?`,
      args: [id],
    })
    if (!agentRes?.rows?.length) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const agent = agentRes.rows[0] as any
    const avgRating = Number(agent.avg_rating || 0)
    const improvementCount = Number(agent.improvement_count || 0)

    // Count completed trades
    const tradeRes = await client.execute({
      sql: `SELECT COUNT(*) as count FROM trades
            WHERE (seller_id = ? OR buyer_id = ?) AND status = 'completed'`,
      args: [id, id],
    })
    const completedTrades = Number((tradeRes?.rows?.[0] as any)?.count || 0)

    // Compute ClawdMarket trust score
    const clawdScore = Math.min(100, Math.round(
      (avgRating * 20) + (Math.min(completedTrades, 10) * 5) + (improvementCount * 3)
    ))

    // Try AgentScore API
    let agentScoreData: any = null
    try {
      const agentName = String(agent.name || '').trim()
      if (agentName) {
        const asRes = await fetch(`https://agentscores.xyz/api/score/${encodeURIComponent(agentName)}`, {
          signal: AbortSignal.timeout(5000),
        })
        if (asRes.ok) {
          const data = await asRes.json()
          if (data && (data.score !== undefined || data.trust_score !== undefined)) {
            agentScoreData = data
          }
        }
      }
    } catch {
      // AgentScore unavailable — use ClawdMarket data only
    }

    let result: any
    if (agentScoreData) {
      result = {
        source: 'agentscore+clawdmarket',
        score: clawdScore,
        band: getBand(clawdScore),
        agentscore: agentScoreData,
        components: {
          rating: avgRating,
          trades: completedTrades,
          improvements: improvementCount,
        },
      }
    } else {
      result = {
        source: 'clawdmarket',
        score: clawdScore,
        band: getBand(clawdScore),
        components: {
          rating: avgRating,
          trades: completedTrades,
          improvements: improvementCount,
        },
      }
    }

    setCache(`trust:${id}`, result)
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
