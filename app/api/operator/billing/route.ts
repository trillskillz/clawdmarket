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

type BillingAlert = {
  severity: 'warning' | 'critical'
  code: 'quota_near_exhaustion' | 'quota_exhausted' | 'overage_cap_near' | 'overage_cap_exceeded'
  agent_id: string
  agent_name: string
  feature?: AgentUsageFeature
  message: string
}

type BillingReport = {
  operator_address: string
  generated_at: string
  window: { starts_at: string; ends_at: string; reset_at: string }
  agent_count: number
  features: Record<AgentUsageFeature, ReturnType<typeof makeQuota> & { over_quota_agents?: number }>
  overage: {
    attempts_24h: number
    attempts_30d: number
    paid_conversions_24h: number
    paid_conversions_30d: number
    conversion_rate_30d: number
    revenue_24h_usd: number
    revenue_30d_usd: number
    last_paid_conversion_at: string | null
  }
  alerts: BillingAlert[]
  trend_7d: BillingTrendPoint[]
  agents: any[]
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

function floatEnv(name: string, fallback: number) {
  const value = Number.parseFloat(process.env[name] || '')
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function csvEscape(value: unknown) {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function wantsCsv(req: NextRequest) {
  return req.nextUrl.searchParams.get('format') === 'csv'
    || (req.headers.get('accept') || '').toLowerCase().includes('text/csv')
}

function billingCsv(report: BillingReport) {
  const headers = [
    'agent_id',
    'agent_name',
    'status',
    'task_posts_used_today',
    'task_posts_free_limit',
    'task_posts_remaining_today',
    'task_posts_utilization',
    'task_bids_used_today',
    'task_bids_free_limit',
    'task_bids_remaining_today',
    'task_bids_utilization',
    'service_listings_used_today',
    'service_listings_free_limit',
    'service_listings_remaining_today',
    'service_listings_utilization',
    'overage_attempts_24h',
    'overage_attempts_30d',
    'paid_conversions_24h',
    'paid_conversions_30d',
    'overage_spend_24h_usd',
    'overage_spend_30d_usd',
    'daily_spend_cap_usd',
    'last_paid_conversion_at',
    'alert_count',
    'alert_codes',
  ]

  const rows = report.agents.map((agent) => {
    const alertCodes = (agent.alerts || []).map((alert: BillingAlert) => alert.code).join('|')
    return [
      agent.id,
      agent.name,
      agent.status,
      agent.quota.task_posts.used_today,
      agent.quota.task_posts.free_limit,
      agent.quota.task_posts.remaining_today,
      agent.quota.task_posts.utilization,
      agent.quota.task_bids.used_today,
      agent.quota.task_bids.free_limit,
      agent.quota.task_bids.remaining_today,
      agent.quota.task_bids.utilization,
      agent.quota.service_listings.used_today,
      agent.quota.service_listings.free_limit,
      agent.quota.service_listings.remaining_today,
      agent.quota.service_listings.utilization,
      agent.overage.attempts_24h,
      agent.overage.attempts_30d,
      agent.overage.paid_conversions_24h,
      agent.overage.paid_conversions_30d,
      agent.overage.revenue_24h_usd,
      agent.overage.revenue_30d_usd,
      agent.settings.daily_spend_cap_usd ?? '',
      agent.overage.last_paid_conversion_at || '',
      (agent.alerts || []).length,
      alertCodes,
    ].map(csvEscape).join(',')
  })

  return [headers.join(','), ...rows].join('\n') + '\n'
}

function csvResponse(report: BillingReport) {
  const csv = billingCsv(report)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="clawdmarket-operator-billing-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
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

async function ensureOperatorSettingsTable() {
  await (db as any).$client.execute({
    sql: `CREATE TABLE IF NOT EXISTS operator_settings (
      agent_id TEXT PRIMARY KEY,
      daily_spend_cap REAL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    args: [],
  })
}

function buildQuotaAlerts(agent: { id: string; name: string }, quotas: Record<AgentUsageFeature, ReturnType<typeof makeQuota>>, threshold: number) {
  const alerts: BillingAlert[] = []
  for (const feature of FEATURES) {
    const quota = quotas[feature]
    if (quota.over_quota) {
      alerts.push({
        severity: 'critical',
        code: 'quota_exhausted',
        agent_id: agent.id,
        agent_name: agent.name,
        feature,
        message: `${quota.feature} daily free quota is exhausted.`,
      })
    } else if (quota.utilization >= threshold) {
      alerts.push({
        severity: 'warning',
        code: 'quota_near_exhaustion',
        agent_id: agent.id,
        agent_name: agent.name,
        feature,
        message: `${quota.feature} daily free quota is at ${Math.round(quota.utilization * 100)}%.`,
      })
    }
  }
  return alerts
}

function buildOverageCapAlerts(agent: { id: string; name: string }, overageSpend24h: number, dailySpendCap: number | null, threshold: number) {
  if (!dailySpendCap || dailySpendCap <= 0) return []
  if (overageSpend24h >= dailySpendCap) {
    return [{
      severity: 'critical' as const,
      code: 'overage_cap_exceeded' as const,
      agent_id: agent.id,
      agent_name: agent.name,
      message: `24h overage spend $${roundUsd(overageSpend24h)} crossed the configured $${roundUsd(dailySpendCap)} daily cap.`,
    }]
  }
  if (overageSpend24h >= dailySpendCap * threshold) {
    return [{
      severity: 'warning' as const,
      code: 'overage_cap_near' as const,
      agent_id: agent.id,
      agent_name: agent.name,
      message: `24h overage spend $${roundUsd(overageSpend24h)} is near the configured $${roundUsd(dailySpendCap)} daily cap.`,
    }]
  }
  return []
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
    const emptyReport: BillingReport = {
      operator_address: address,
      generated_at: new Date().toISOString(),
      window: {
        starts_at: window.starts_at,
        ends_at: window.ends_at,
        reset_at: window.reset_at,
      },
      agent_count: 0,
      features: {
        task_posts: makeQuota('task_posts', 0, 0),
        task_bids: makeQuota('task_bids', 0, 0),
        service_listings: makeQuota('service_listings', 0, 0),
      },
      overage: {
        attempts_24h: 0,
        attempts_30d: 0,
        paid_conversions_24h: 0,
        paid_conversions_30d: 0,
        conversion_rate_30d: 0,
        revenue_24h_usd: 0,
        revenue_30d_usd: 0,
        last_paid_conversion_at: null,
      },
      alerts: [],
      trend_7d: sevenDayTrend([]),
      agents: [],
    }
    return wantsCsv(req)
      ? csvResponse(emptyReport)
      : NextResponse.json(emptyReport, { headers: { 'Cache-Control': 'no-store' } })
  }

  const window = getAgentUsageWindow()
  const quotaAlertThreshold = Math.min(1, Math.max(0.1, floatEnv('CLAWDMARKET_OPERATOR_QUOTA_ALERT_THRESHOLD', 0.8)))
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

  await ensureOperatorSettingsTable()
  const settingsResult = await client.execute({
    sql: `SELECT agent_id, daily_spend_cap
          FROM operator_settings
          WHERE agent_id IN (${ids})`,
    args: agentIds,
  })
  const spendCaps = new Map<string, number | null>()
  for (const row of settingsResult?.rows || []) {
    const cap = num((row as any).daily_spend_cap)
    spendCaps.set(String((row as any).agent_id), cap > 0 ? cap : null)
  }

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
    const revenue24h = eventAmount(events24hMap, agent.id, 'task_posts', 'paid_conversion')
      + eventAmount(events24hMap, agent.id, 'task_bids', 'paid_conversion')
    const revenue30d = eventAmount(events30dMap, agent.id, 'task_posts', 'paid_conversion')
      + eventAmount(events30dMap, agent.id, 'task_bids', 'paid_conversion')

    const lastPaidTask = eventLastAt(events30dMap, agent.id, 'task_posts', 'paid_conversion')
    const lastPaidBid = eventLastAt(events30dMap, agent.id, 'task_bids', 'paid_conversion')
    const lastPaidAt = [lastPaidTask, lastPaidBid].filter(Boolean).sort().at(-1) || null
    const quota = {
      task_posts: taskQuota,
      task_bids: bidQuota,
      service_listings: serviceQuota,
    }
    const dailySpendCap = spendCaps.get(agent.id) ?? null
    const alerts = [
      ...buildQuotaAlerts(agent, quota, quotaAlertThreshold),
      ...buildOverageCapAlerts(agent, revenue24h, dailySpendCap, quotaAlertThreshold),
    ]

    return {
      id: agent.id,
      name: agent.name,
      status: agent.status,
      quota,
      settings: {
        daily_spend_cap_usd: dailySpendCap,
      },
      overage: {
        attempts_24h: attempts24h,
        attempts_30d: attempts30d,
        paid_conversions_24h: paid24h,
        paid_conversions_30d: paid30d,
        conversion_rate_30d: attempts30d > 0 ? paid30d / attempts30d : 0,
        revenue_24h_usd: roundUsd(revenue24h),
        revenue_30d_usd: roundUsd(revenue30d),
        last_paid_conversion_at: lastPaidAt,
      },
      alerts,
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
  const revenue24h = agentRows.reduce((sum, agent) => sum + agent.overage.revenue_24h_usd, 0)
  const revenue30d = agentRows.reduce((sum, agent) => sum + agent.overage.revenue_30d_usd, 0)
  const lastPaidAt = agentRows.map((agent) => agent.overage.last_paid_conversion_at).filter(Boolean).sort().at(-1) || null
  const sortedAgents = agentRows.sort((a, b) => {
    const bCritical = b.alerts.filter((alert: BillingAlert) => alert.severity === 'critical').length
    const aCritical = a.alerts.filter((alert: BillingAlert) => alert.severity === 'critical').length
    if (bCritical !== aCritical) return bCritical - aCritical
    const bPressure = b.quota.task_posts.utilization + b.quota.task_bids.utilization + b.overage.attempts_30d
    const aPressure = a.quota.task_posts.utilization + a.quota.task_bids.utilization + a.overage.attempts_30d
    return bPressure - aPressure
  })

  const report: BillingReport = {
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
      revenue_24h_usd: roundUsd(revenue24h),
      revenue_30d_usd: roundUsd(revenue30d),
      last_paid_conversion_at: lastPaidAt,
    },
    alerts: sortedAgents.flatMap((agent) => agent.alerts),
    trend_7d: sevenDayTrend(trendResult?.rows || []),
    agents: sortedAgents,
  }

  return wantsCsv(req)
    ? csvResponse(report)
    : NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } })
}
