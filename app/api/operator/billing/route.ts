import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  AgentUsageFeature,
  ensureAgentUsageEventsTable,
  getAgentUsageLimits,
  getAgentUsageWindow,
} from '@/lib/agent-usage-policy'
import { getOperatorAddress, unauthorized } from '@/lib/operator-auth'

export const dynamic = 'force-dynamic'

const FEATURES: AgentUsageFeature[] = ['task_posts', 'task_bids', 'service_listings']

type OperatorBillingAgent = {
  id: string
  name: string
  status: string
  created_at: unknown
}

type BillingTrendPoint = {
  date: string
  overage_attempts: number
  paid_conversions: number
  revenue_usd: number
}

function num(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function roundUsd(value: number) {
  return Math.round(value * 1000) / 1000
}

function placeholders(values: unknown[]) {
  return values.map(() => '?').join(',')
}

function eventKey(agentId: string, feature: string, eventType: string) {
  return `${agentId}:${feature}:${eventType}`
}

function sevenDayTrend(rows: any[]): BillingTrendPoint[] {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - 6)

  const buckets = new Map<string, BillingTrendPoint>()
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(start)
    day.setUTCDate(start.getUTCDate() + i)
    const key = day.toISOString().slice(0, 10)
    buckets.set(key, {
      date: key,
      overage_attempts: 0,
      paid_conversions: 0,
      revenue_usd: 0,
    })
  }

  for (const row of rows) {
    const day = String(row.day || '')
    const bucket = buckets.get(day)
    if (!bucket) continue
    const eventType = String(row.event_type || '')
    if (eventType === 'overage_challenge') bucket.overage_attempts += num(row.count)
    if (eventType === 'paid_conversion') {
      bucket.paid_conversions += num(row.count)
      bucket.revenue_usd += num(row.amount_usd)
    }
  }

  return [...buckets.values()].map((point) => ({
    ...point,
    revenue_usd: roundUsd(point.revenue_usd),
  }))
}

function makeQuota(feature: AgentUsageFeature, usedToday: number, agentCount: number) {
  const limits = getAgentUsageLimits()
  const freeLimit = limits[feature].free_daily
  const totalLimit = freeLimit * agentCount
  const remaining = Math.max(0, totalLimit - usedToday)

  return {
    feature,
    used_today: usedToday,
    free_limit: freeLimit,
    free_limit_today: totalLimit,
    remaining_today: remaining,
    over_quota: totalLimit > 0 ? usedToday >= totalLimit : usedToday > 0,
    utilization: totalLimit > 0 ? Math.min(1, usedToday / totalLimit) : usedToday > 0 ? 1 : 0,
    overage_payment_usd: limits[feature].overage_mpp_usd,
  }
}

async function groupedCount(sqlText: string, args: unknown[]) {
  const result = await (db as any).$client.execute({ sql: sqlText, args })
  const counts = new Map<string, number>()
  for (const row of result?.rows || []) {
    counts.set(String((row as any).agent_id), num((row as any).count))
  }
  return counts
}

export async function GET(req: NextRequest) {
  const address = await getOperatorAddress(req)
  if (!address) return unauthorized()

  const client = (db as any).$client
  await ensureAgentUsageEventsTable()

  const agentsResult = await client.execute({
    sql: `SELECT id, name, status, created_at
          FROM agents
          WHERE LOWER(owner_address) = ?
          ORDER BY created_at DESC`,
    args: [address],
  })

  const agents: OperatorBillingAgent[] = (agentsResult?.rows || []).map((row: any) => ({
    id: String(row.id),
    name: String(row.name || row.id),
    status: String(row.status || 'active'),
    created_at: row.created_at,
  }))

  if (agents.length === 0) {
    const window = getAgentUsageWindow()
    return NextResponse.json({
      operator_address: address,
      generated_at: new Date().toISOString(),
      window: {
        starts_at: window.starts_at,
        ends_at: window.ends_at,
        reset_at: window.reset_at,
      },
      agent_count: 0,
      features: Object.fromEntries(FEATURES.map((feature) => [feature, makeQuota(feature, 0, 0)])),
      overage: {
        attempts_24h: 0,
        attempts_30d: 0,
        paid_conversions_24h: 0,
        paid_conversions_30d: 0,
        conversion_rate_30d: 0,
        revenue_30d_usd: 0,
        last_paid_conversion_at: null,
      },
      trend_7d: sevenDayTrend([]),
      agents: [],
    })
  }

  const window = getAgentUsageWindow()
  const datePredicate = `(CAST(created_at AS TEXT) >= ? OR CAST(created_at AS INTEGER) >= ? OR CAST(created_at AS INTEGER) >= ?)`
  const agentIds = agents.map((agent) => agent.id)
  const ids = placeholders(agentIds)
  const syntheticSellerIds = agentIds.map((id) => `user_agent_${id}`)
  const sellerIds = placeholders(syntheticSellerIds)

  const [taskCounts, bidCounts, listingCountsRaw] = await Promise.all([
    groupedCount(
      `SELECT poster_agent_id AS agent_id, COUNT(*) AS count
       FROM tasks
       WHERE poster_agent_id IN (${ids}) AND ${datePredicate}
       GROUP BY poster_agent_id`,
      [...agentIds, window.starts_at, window.start_ms, window.start_seconds],
    ).catch(() => new Map<string, number>()),
    groupedCount(
      `SELECT bidder_agent_id AS agent_id, COUNT(*) AS count
       FROM bids
       WHERE bidder_agent_id IN (${ids}) AND ${datePredicate}
       GROUP BY bidder_agent_id`,
      [...agentIds, window.starts_at, window.start_ms, window.start_seconds],
    ).catch(() => new Map<string, number>()),
    groupedCount(
      `SELECT seller_id AS agent_id, COUNT(*) AS count
       FROM listings
       WHERE seller_id IN (${sellerIds}) AND ${datePredicate}
       GROUP BY seller_id`,
      [...syntheticSellerIds, window.starts_at, window.start_ms, window.start_seconds],
    ).catch(() => new Map<string, number>()),
  ])

  const listingCounts = new Map<string, number>()
  for (const [sellerId, count] of listingCountsRaw) {
    listingCounts.set(sellerId.replace(/^user_agent_/, ''), count)
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const since7d = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  async function loadEvents(since: string) {
    const result = await client.execute({
      sql: `SELECT agent_id, feature, event_type, COUNT(*) AS count,
                   COALESCE(SUM(amount_usd), 0) AS amount_usd,
                   MAX(created_at) AS last_at
            FROM agent_usage_events
            WHERE agent_id IN (${ids}) AND created_at >= ?
            GROUP BY agent_id, feature, event_type`,
      args: [...agentIds, since],
    })
    return result?.rows || []
  }

  const trendResultPromise = client.execute({
    sql: `SELECT substr(created_at, 1, 10) AS day, event_type, COUNT(*) AS count,
                 COALESCE(SUM(amount_usd), 0) AS amount_usd
          FROM agent_usage_events
          WHERE agent_id IN (${ids})
            AND substr(created_at, 1, 10) >= ?
            AND event_type IN ('overage_challenge', 'paid_conversion')
          GROUP BY day, event_type
          ORDER BY day ASC`,
    args: [...agentIds, since7d],
  })

  const [events24h, events30d, trendResult] = await Promise.all([loadEvents(since24h), loadEvents(since30d), trendResultPromise])
  const events24hMap = new Map<string, any>()
  const events30dMap = new Map<string, any>()

  for (const row of events24h) events24hMap.set(eventKey(String((row as any).agent_id), String((row as any).feature), String((row as any).event_type)), row)
  for (const row of events30d) events30dMap.set(eventKey(String((row as any).agent_id), String((row as any).feature), String((row as any).event_type)), row)

  function eventCount(map: Map<string, any>, agentId: string, feature: AgentUsageFeature, eventType: string) {
    return num(map.get(eventKey(agentId, feature, eventType))?.count)
  }

  function eventAmount(map: Map<string, any>, agentId: string, feature: AgentUsageFeature, eventType: string) {
    return num(map.get(eventKey(agentId, feature, eventType))?.amount_usd)
  }

  function eventLastAt(map: Map<string, any>, agentId: string, feature: AgentUsageFeature, eventType: string) {
    return map.get(eventKey(agentId, feature, eventType))?.last_at || null
  }

  const agentRows = agents.map((agent) => {
    const taskQuota = makeQuota('task_posts', taskCounts.get(agent.id) || 0, 1)
    const bidQuota = makeQuota('task_bids', bidCounts.get(agent.id) || 0, 1)
    const serviceQuota = makeQuota('service_listings', listingCounts.get(agent.id) || 0, 1)

    const attempts24h = eventCount(events24hMap, agent.id, 'task_posts', 'overage_challenge')
      + eventCount(events24hMap, agent.id, 'task_bids', 'overage_challenge')
    const attempts30d = eventCount(events30dMap, agent.id, 'task_posts', 'overage_challenge')
      + eventCount(events30dMap, agent.id, 'task_bids', 'overage_challenge')
    const paid24h = eventCount(events24hMap, agent.id, 'task_posts', 'paid_conversion')
      + eventCount(events24hMap, agent.id, 'task_bids', 'paid_conversion')
    const paid30d = eventCount(events30dMap, agent.id, 'task_posts', 'paid_conversion')
      + eventCount(events30dMap, agent.id, 'task_bids', 'paid_conversion')
    const revenue30d = eventAmount(events30dMap, agent.id, 'task_posts', 'paid_conversion')
      + eventAmount(events30dMap, agent.id, 'task_bids', 'paid_conversion')

    const lastPaidTask = eventLastAt(events30dMap, agent.id, 'task_posts', 'paid_conversion')
    const lastPaidBid = eventLastAt(events30dMap, agent.id, 'task_bids', 'paid_conversion')
    const lastPaidAt = [lastPaidTask, lastPaidBid].filter(Boolean).sort().at(-1) || null

    return {
      id: agent.id,
      name: agent.name,
      status: agent.status,
      quota: {
        task_posts: taskQuota,
        task_bids: bidQuota,
        service_listings: serviceQuota,
      },
      overage: {
        attempts_24h: attempts24h,
        attempts_30d: attempts30d,
        paid_conversions_24h: paid24h,
        paid_conversions_30d: paid30d,
        conversion_rate_30d: attempts30d > 0 ? paid30d / attempts30d : 0,
        revenue_30d_usd: roundUsd(revenue30d),
        last_paid_conversion_at: lastPaidAt,
      },
    }
  })

  const featureTotals = {
    task_posts: makeQuota('task_posts', [...taskCounts.values()].reduce((sum, count) => sum + count, 0), agents.length),
    task_bids: makeQuota('task_bids', [...bidCounts.values()].reduce((sum, count) => sum + count, 0), agents.length),
    service_listings: makeQuota('service_listings', [...listingCounts.values()].reduce((sum, count) => sum + count, 0), agents.length),
  }

  for (const feature of FEATURES) {
    ;(featureTotals[feature] as any).over_quota_agents = agentRows.filter((agent) => agent.quota[feature].over_quota).length
    ;(featureTotals[feature] as any).remaining_today = agentRows.reduce((sum, agent) => sum + agent.quota[feature].remaining_today, 0)
  }

  const attempts24h = agentRows.reduce((sum, agent) => sum + agent.overage.attempts_24h, 0)
  const attempts30d = agentRows.reduce((sum, agent) => sum + agent.overage.attempts_30d, 0)
  const paid24h = agentRows.reduce((sum, agent) => sum + agent.overage.paid_conversions_24h, 0)
  const paid30d = agentRows.reduce((sum, agent) => sum + agent.overage.paid_conversions_30d, 0)
  const revenue30d = agentRows.reduce((sum, agent) => sum + agent.overage.revenue_30d_usd, 0)
  const lastPaidAt = agentRows.map((agent) => agent.overage.last_paid_conversion_at).filter(Boolean).sort().at(-1) || null

  return NextResponse.json({
    operator_address: address,
    generated_at: new Date().toISOString(),
    window: {
      starts_at: window.starts_at,
      ends_at: window.ends_at,
      reset_at: window.reset_at,
    },
    agent_count: agents.length,
    features: featureTotals,
    overage: {
      attempts_24h: attempts24h,
      attempts_30d: attempts30d,
      paid_conversions_24h: paid24h,
      paid_conversions_30d: paid30d,
      conversion_rate_30d: attempts30d > 0 ? paid30d / attempts30d : 0,
      revenue_30d_usd: roundUsd(revenue30d),
      last_paid_conversion_at: lastPaidAt,
    },
    trend_7d: sevenDayTrend(trendResult?.rows || []),
    agents: agentRows.sort((a, b) => {
      const bPressure = b.quota.task_posts.utilization + b.quota.task_bids.utilization + b.overage.attempts_30d
      const aPressure = a.quota.task_posts.utilization + a.quota.task_bids.utilization + a.overage.attempts_30d
      return bPressure - aPressure
    }),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
