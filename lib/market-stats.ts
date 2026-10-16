import { getIndependentEconomicEvidence } from './independent-economic-evidence'
import { getRouteMetrics } from './route-metrics'
import { loadMarketplaceCohorts, MARKETPLACE_COHORTS } from './marketplace-cohorts'
import { PAYMENT_READY_LISTING_SQL } from './listing-payment-readiness'
import { getAgentAvailability } from './agent-presence'
import { getExecutablePublicServiceCount } from './marketplace-inventory'
import { rankedBuyerFeedbackSql } from './reputation-evidence-sql'
import { and, eq, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents, listings, payment_receipts, ratings, tasks, trades } from '@/lib/schema'
import { AGENT_ONLINE_WINDOW_SECONDS } from '@/lib/agent-presence'
import { publicTradeWhereSql } from '@/lib/public-trade-visibility'
import { PUBLIC_AGENT_DIRECTORY_WHERE_SQL } from '@/lib/public-agent-directory'
import { PUBLIC_LISTING_SELLER_WHERE_SQL } from '@/lib/listing-visibility'

type VolumeByRail = {
  ledger: number
  credit: number
  mpp: number
  evm: number
}

function roundCurrency(value: unknown) {
  return Number(Number(value || 0).toFixed(2))
}

async function getPublicProfilePrincipals(): Promise<string[]> {
  // An account has a profile as soon as it joins. Synthetic agent accounts
  // count through their public registration or visible active listing instead.
  const result = await (db as any).$client.execute({
    sql: `SELECT principal_id FROM (
      SELECT id AS principal_id FROM users WHERE substr(id, 1, 11) <> 'user_agent_'
      UNION
      SELECT seller_id AS principal_id FROM listings
      WHERE status = 'active' AND ${PUBLIC_LISTING_SELLER_WHERE_SQL}
      UNION
      SELECT 'user_agent_' || id AS principal_id FROM agents
      WHERE visibility = 'public' AND archived_at IS NULL
    )`,
    args: [],
  })
  return result.rows.map((row: any) => String(row.principal_id))
}

async function getVolumeByRail(): Promise<VolumeByRail> {
  const volume: VolumeByRail = { ledger: 0, credit: 0, mpp: 0, evm: 0 }
  const rows = await db
      .select({
        rail: trades.payment_rail,
        amount: sql<number>`COALESCE(SUM(${trades.amount}), 0)`,
      })
      .from(trades)
      .where(and(or(eq(trades.status, 'completed'), eq(trades.status, 'complete')), sql.raw(publicTradeWhereSql('trades'))))
      .groupBy(trades.payment_rail)

    for (const row of rows) {
      const rail = String(row.rail || '').toLowerCase()
      if (rail === 'ledger' || rail === 'credit' || rail === 'mpp' || rail === 'evm') {
        volume[rail] = roundCurrency(row.amount)
      }
    }
  return volume
}

export async function getMarketStats() {
  const [
    registeredRows,
    onlineRows,
    tradeRows,
    receiptRows,
    ratingRows,
    taskRows,
    listingRows,
    queriedProfilePrincipals,
    volumeByRail,
  ] = await Promise.all([
    db.select({ registered_agent_count: sql<number>`COALESCE(COUNT(*), 0)` })
      .from(agents)
      .where(sql.raw(PUBLIC_AGENT_DIRECTORY_WHERE_SQL)),
    db.select({
      agents_online: sql<number>`COALESCE(SUM(CASE
        WHEN ${agents.status} = 'active'
          AND ${agents.lastSeenAt} >= unixepoch() - ${AGENT_ONLINE_WINDOW_SECONDS}
        THEN 1 ELSE 0 END), 0)`,
    }).from(agents)
      .where(sql.raw(PUBLIC_AGENT_DIRECTORY_WHERE_SQL)),
    db.select({
      total_trades: sql<number>`COALESCE(COUNT(*), 0)`,
      completed_trades: sql<number>`COALESCE(SUM(CASE WHEN ${trades.status} IN ('completed', 'complete') THEN 1 ELSE 0 END), 0)`,
      trade_volume_usd: sql<number>`COALESCE(SUM(CASE WHEN ${trades.status} IN ('completed', 'complete') THEN ${trades.amount} ELSE 0 END), 0)`,
      platform_fees_usd: sql<number>`COALESCE(SUM(CASE
        WHEN ${trades.status} IN ('completed', 'complete')
        THEN CASE WHEN ${trades.platform_fee} > 0 THEN ${trades.platform_fee} ELSE ${trades.fee} END
        ELSE 0 END), 0)`,
      trades_today: sql<number>`COALESCE(SUM(CASE WHEN date(
        CASE
          WHEN typeof(${trades.created_at}) IN ('integer', 'real') AND ${trades.created_at} > 9999999999 THEN datetime(${trades.created_at} / 1000, 'unixepoch')
          WHEN typeof(${trades.created_at}) IN ('integer', 'real') THEN datetime(${trades.created_at}, 'unixepoch')
          ELSE datetime(${trades.created_at})
        END
      ) = date('now') THEN 1 ELSE 0 END), 0)`,
      volume_last_24h: sql<number>`COALESCE(SUM(CASE
        WHEN ${trades.status} IN ('completed', 'complete') AND datetime(
          CASE
            WHEN typeof(COALESCE(${trades.completed_at}, ${trades.created_at})) IN ('integer', 'real')
              AND COALESCE(${trades.completed_at}, ${trades.created_at}) > 9999999999
              THEN COALESCE(${trades.completed_at}, ${trades.created_at}) / 1000
            WHEN typeof(COALESCE(${trades.completed_at}, ${trades.created_at})) IN ('integer', 'real')
              THEN COALESCE(${trades.completed_at}, ${trades.created_at})
            ELSE strftime('%s', COALESCE(${trades.completed_at}, ${trades.created_at}))
          END,
          'unixepoch'
        ) >= datetime('now', '-1 day')
        THEN ${trades.amount} ELSE 0 END), 0)`,
    }).from(trades).where(sql.raw(publicTradeWhereSql('trades'))),
    db.select({
      receipt_volume_usd: sql<number>`COALESCE(SUM(${payment_receipts.usd_value_at_payment}), 0)`,
    }).from(payment_receipts)
      .innerJoin(trades, eq(payment_receipts.trade_id, trades.id))
      .where(and(
        or(eq(trades.status, 'completed'), eq(trades.status, 'complete')),
        sql`${payment_receipts.usd_value_at_payment} IS NOT NULL`, sql.raw(publicTradeWhereSql('trades')),
      )),
    db.select({ avg_rating: sql<number | null>`AVG(${ratings.score})` })
      .from(ratings).where(sql.raw(`ratings.id IN (SELECT id FROM (${rankedBuyerFeedbackSql('1=1')}) WHERE feedback_rank=1)`)),
    db.select({
      tasks_total: sql<number>`COALESCE(COUNT(*), 0)`,
      tasks_routed: sql<number>`COALESCE(SUM(CASE
        WHEN ${tasks.assignedAgentId} IS NOT NULL OR ${tasks.status} IN ('assigned', 'completed', 'complete')
        THEN 1 ELSE 0 END), 0)`,
      tasks_completed: sql<number>`COALESCE(SUM(CASE WHEN ${tasks.status} IN ('completed', 'complete') THEN 1 ELSE 0 END), 0)`,
      tasks_open: sql<number>`COALESCE(SUM(CASE WHEN ${tasks.status} = 'open'
        AND datetime(${tasks.expiresAt}) > datetime('now')
        AND (${tasks.deadlineAt} IS NULL OR datetime(${tasks.deadlineAt}) > datetime('now'))
        THEN 1 ELSE 0 END), 0)`,
    }).from(tasks),
    db.select({
      services_listed: sql<number>`COALESCE(COUNT(*), 0)`,
      services_online: sql<number>`COALESCE(SUM(CASE WHEN ${listings.status} = 'active' THEN 1 ELSE 0 END), 0)`,
      marketplace_profile_count: sql<number>`COALESCE(COUNT(DISTINCT CASE
        WHEN ${listings.status} = 'active' THEN ${listings.seller_id} END), 0)`,
    }).from(listings).where(sql.raw(PUBLIC_LISTING_SELLER_WHERE_SQL)),
    getPublicProfilePrincipals(),
    getVolumeByRail(),
  ])

  const [publicAgents, executableServices, paymentReady, independentEconomics, routeMetrics] = await Promise.all([
    db.select({ id: agents.id, status: agents.status, last_seen_at: agents.lastSeenAt }).from(agents).where(and(eq(agents.visibility, 'public'), sql`${agents.archivedAt} IS NULL`)),
    getExecutablePublicServiceCount(),
    db.select({ count: sql<number>`COUNT(*)` }).from(listings).where(and(eq(listings.status, 'active'), sql.raw(PUBLIC_LISTING_SELLER_WHERE_SQL), sql.raw(PAYMENT_READY_LISTING_SQL))),
    getIndependentEconomicEvidence(),
    getRouteMetrics(),
  ])
  const cohorts = await loadMarketplaceCohorts([...new Set([...queriedProfilePrincipals, ...publicAgents.map(agent => `user_agent_${agent.id}`)])])
  const profileCohorts = Object.fromEntries(MARKETPLACE_COHORTS.map(cohort => [cohort, 0]))
  for (const id of queriedProfilePrincipals) profileCohorts[cohorts.get(id)!.cohort]++
  const cohortCounts = Object.fromEntries(MARKETPLACE_COHORTS.map(cohort => [cohort, { registered: 0, recently_online: 0 }]))
  for (const agent of publicAgents) {
    const attribution = cohorts.get(`user_agent_${agent.id}`)!
    cohortCounts[attribution.cohort].registered++
    if (getAgentAvailability(agent.status, agent.last_seen_at) === 'online') cohortCounts[attribution.cohort].recently_online++
  }
  const registeredAgentCount = Number(registeredRows[0]?.registered_agent_count || 0)
  const marketplaceProfileCount = Number(listingRows[0]?.marketplace_profile_count || 0)
  const publicProfileCount = queriedProfilePrincipals.length
  const tradeVolume = roundCurrency(tradeRows[0]?.trade_volume_usd)
  const receiptVolume = roundCurrency(receiptRows[0]?.receipt_volume_usd)
  const recordedVolume = tradeVolume > 0 ? tradeVolume : receiptVolume

  return {
    data_status: 'available' as const,
    observed_at: new Date().toISOString(),
    cohort_counts: cohortCounts,
    profile_cohort_counts: profileCohorts,
    public_registered_agent_count: publicAgents.length,
    active_public_registered_agent_count: registeredAgentCount,
    cohort_attribution: 'operator_records_only',
    independence_status: 'Only explicitly reviewed, unexpired ownership evidence qualifies; unrecognized ownership remains unverified.',
    listings_total: Number(listingRows[0]?.services_listed || 0),
    listings_active: Number(listingRows[0]?.services_online || 0),
    listings_external_payment_ready: Number(paymentReady[0]?.count || 0),
    executable_reusable_services: executableServices,
    tasks_assigned: Number(taskRows[0]?.tasks_routed || 0),
    economic_adoption: { independently_attributed_volume_usd: independentEconomics.volume_usd, independently_attributed_completed_trades: independentEconomics.completed_trades, qualifying_independent_autonomous_volume_usd: Number(routeMetrics.independently_attributed_autonomously_routed_gmv),
      recorded_completed_volume_by_ownership: independentEconomics.recorded_volume_by_ownership,
      status: 'measured' as const, coverage: 'Only current reviewed ownership attributions qualify; unknown and expired cohorts are excluded, not treated as independent.', explanation: 'Recorded transactions include controlled and unknown cohorts. They are not proof of independent adoption.' },
    legacy_aliases: { services_listed: 'listings_total', services_online: 'listings_active', tasks_routed: 'tasks_assigned', transactions_settled: 'completed_trades; completion status alone does not confirm external settlement' },
    // Public headline metrics share one deduplicated account/agent profile count.
    agent_count: publicProfileCount,
    marketplace_profile_count: publicProfileCount,
    network_profile_count: publicProfileCount,
    active_seller_count: marketplaceProfileCount,
    registered_agent_count: registeredAgentCount,
    agents_registered: registeredAgentCount,
    agents_online: Number(onlineRows[0]?.agents_online || 0),

    total_trades: Number(tradeRows[0]?.total_trades || 0),
    trade_count: Number(tradeRows[0]?.total_trades || 0),
    completed_trades: Number(tradeRows[0]?.completed_trades || 0),
    transactions_settled: Number(tradeRows[0]?.completed_trades || 0),
    trades_today: Number(tradeRows[0]?.trades_today || 0),
    recorded_volume_usd: recordedVolume,
    total_volume_usd: recordedVolume,
    trade_volume_usd: tradeVolume,
    platform_fees_usd: roundCurrency(tradeRows[0]?.platform_fees_usd),
    volume_last_24h: roundCurrency(tradeRows[0]?.volume_last_24h),
    volume_24h: roundCurrency(tradeRows[0]?.volume_last_24h),
    volume_by_rail: volumeByRail,

    avg_rating: ratingRows[0]?.avg_rating == null ? null : Number(ratingRows[0].avg_rating),
    total_tasks: Number(taskRows[0]?.tasks_total || 0),
    tasks_total: Number(taskRows[0]?.tasks_total || 0),
    tasks_routed: Number(taskRows[0]?.tasks_routed || 0),
    tasks_completed: Number(taskRows[0]?.tasks_completed || 0),
    tasks_open: Number(taskRows[0]?.tasks_open || 0),
    services_listed: Number(listingRows[0]?.services_listed || 0),
    services_online: Number(listingRows[0]?.services_online || 0),
    updated_at: new Date().toISOString(),
  }
}
