import { NextResponse } from 'next/server'
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from '@/lib/constants'
import { db } from '@/lib/db'

export type AgentUsageFeature = 'task_posts' | 'task_bids' | 'service_listings'

type AgentUsageCounts = Record<AgentUsageFeature, number>

export type AgentUsageQuota = {
  feature: AgentUsageFeature
  used: number
  free_limit: number
  remaining_free: number
  over_quota: boolean
  overage_payment: null | {
    protocol: 'mpp'
    amount_usd: number
  }
}

function intEnv(name: string, fallback: number) {
  const raw = Number.parseInt(process.env[name] || '', 10)
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback
}

export function getAgentUsageLimits() {
  return {
    task_posts: {
      free_daily: intEnv('CLAWDMARKET_FREE_AGENT_TASKS_PER_DAY', 5),
      overage_mpp_usd: 0.001,
    },
    task_bids: {
      free_daily: intEnv('CLAWDMARKET_FREE_AGENT_BIDS_PER_DAY', 20),
      overage_mpp_usd: 0.001,
    },
    service_listings: {
      free_daily: intEnv('CLAWDMARKET_FREE_AGENT_SERVICES_PER_DAY', 5),
      overage_mpp_usd: null,
    },
  }
}

export function getAgentUsageWindow(now = new Date()) {
  const starts = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const ends = new Date(starts.getTime() + 24 * 60 * 60 * 1000)
  return {
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    reset_at: ends.toISOString(),
    start_ms: starts.getTime(),
    start_seconds: Math.floor(starts.getTime() / 1000),
  }
}

async function countSince(sql: string, args: unknown[]) {
  const client = (db as any).$client
  const result = await client.execute({ sql, args })
  return Number(result?.rows?.[0]?.count || 0)
}

export async function getAgentUsageCounts(agentId: string): Promise<AgentUsageCounts> {
  const window = getAgentUsageWindow()
  const syntheticUserId = `user_agent_${agentId}`
  const datePredicate = `(CAST(created_at AS TEXT) >= ? OR CAST(created_at AS INTEGER) >= ? OR CAST(created_at AS INTEGER) >= ?)`

  const [taskPosts, taskBids, serviceListings] = await Promise.all([
    countSince(
      `SELECT COUNT(*) AS count FROM tasks WHERE poster_agent_id = ? AND ${datePredicate}`,
      [agentId, window.starts_at, window.start_ms, window.start_seconds],
    ).catch(() => 0),
    countSince(
      `SELECT COUNT(*) AS count FROM bids WHERE bidder_agent_id = ? AND ${datePredicate}`,
      [agentId, window.starts_at, window.start_ms, window.start_seconds],
    ).catch(() => 0),
    countSince(
      `SELECT COUNT(*) AS count FROM listings WHERE seller_id = ? AND ${datePredicate}`,
      [syntheticUserId, window.starts_at, window.start_ms, window.start_seconds],
    ).catch(() => 0),
  ])

  return {
    task_posts: taskPosts,
    task_bids: taskBids,
    service_listings: serviceListings,
  }
}

export function getFeatureQuota(counts: AgentUsageCounts, feature: AgentUsageFeature): AgentUsageQuota {
  const limits = getAgentUsageLimits()
  const limit = limits[feature].free_daily
  const used = counts[feature] || 0
  const overageAmount = limits[feature].overage_mpp_usd

  return {
    feature,
    used,
    free_limit: limit,
    remaining_free: Math.max(0, limit - used),
    over_quota: used >= limit,
    overage_payment: overageAmount === null ? null : { protocol: 'mpp', amount_usd: overageAmount },
  }
}

export async function getAgentUsageSnapshot(agentId: string) {
  const counts = await getAgentUsageCounts(agentId)
  const window = getAgentUsageWindow()

  return {
    agent_id: agentId,
    window: {
      starts_at: window.starts_at,
      ends_at: window.ends_at,
      reset_at: window.reset_at,
    },
    billing_model: {
      task_posts: 'free_daily_quota_then_mpp',
      task_bids: 'free_daily_quota_then_mpp',
      service_listings: 'free_with_rate_limits',
    },
    usage: {
      task_posts: getFeatureQuota(counts, 'task_posts'),
      task_bids: getFeatureQuota(counts, 'task_bids'),
      service_listings: getFeatureQuota(counts, 'service_listings'),
    },
    payment: {
      over_quota_retry: 'Send MPP payment authorization and include X-ClawdMarket-Agent-Key with the same agent API key.',
      descriptor: 'https://clawdmkt.com/.well-known/mpp.json',
      currency: PATHUSD_ADDRESS,
      chain_id: TEMPO_CHAIN_ID,
    },
  }
}

export function usageHeaders(quota: AgentUsageQuota) {
  return {
    'X-Agent-Usage-Feature': quota.feature,
    'X-Agent-Free-Limit': String(quota.free_limit),
    'X-Agent-Free-Used': String(quota.used),
    'X-Agent-Free-Remaining': String(quota.remaining_free),
  }
}

export function paymentRequiredForQuota(quota: AgentUsageQuota) {
  return NextResponse.json(
    {
      error: 'payment_required',
      message: `Daily free ${quota.feature.replace('_', ' ')} quota exhausted. Pay via MPP and retry with X-ClawdMarket-Agent-Key.`,
      quota,
      payment: {
        protocol: 'mpp',
        amount_usd: quota.overage_payment?.amount_usd || 0.001,
        currency: PATHUSD_ADDRESS,
        chain_id: TEMPO_CHAIN_ID,
        descriptor: 'https://clawdmkt.com/.well-known/mpp.json',
        retry_header: 'X-ClawdMarket-Agent-Key',
      },
    },
    { status: 402, headers: usageHeaders(quota) },
  )
}
