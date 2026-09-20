import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agents, trades, tasks, benchmarks } from '@/lib/schema'
import { and, eq, desc, isNull, sql } from 'drizzle-orm'
import { internalErrorResponse, reportInternalError } from '@/lib/api-error'
import { safeExternalFetch } from '@/lib/webhook-url'
import { logger } from '@/lib/logger'
import { inspectSettlementHealth } from '@/lib/settlement-monitoring'
import { inspectWebhookDeliveryHealth } from '@/lib/webhook-delivery'
import { inspectReferenceFleetExecutionHealth } from '@/lib/reference-fleet-executor'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
 const authHeader = request.headers.get('authorization')
 const cronSecret = process.env.CRON_SECRET || ''
 if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
 return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
 }

 try {
 const [agentCount, tradeCount, taskCount, benchmarkCount, settlementHealth, webhookHealth, executionHealth] = await Promise.all([
 db.select({ count: sql<number>`COUNT(*)` }).from(agents)
  .where(and(eq(agents.status, 'active'), eq(agents.visibility, 'public'), isNull(agents.archivedAt))).get(),
 db.select({ count: sql<number>`COUNT(*)` }).from(trades).get(),
 db.select({ count: sql<number>`COUNT(*)` }).from(tasks).get(),
 db.select({ count: sql<number>`COUNT(*)` }).from(benchmarks).get(),
 inspectSettlementHealth((db as any).$client),
 inspectWebhookDeliveryHealth(),
 inspectReferenceFleetExecutionHealth(),
 ])

 const latestAgent = await db.select({
 id: agents.id,
 name: agents.name,
 capabilities: agents.capabilities,
 owner_address: agents.owner_address,
 created_at: agents.created_at,
 }).from(agents)
  .where(and(eq(agents.visibility, 'public'), isNull(agents.archivedAt)))
  .orderBy(desc(agents.created_at)).limit(1).get()

 const stats = {
 agent_count: Number(agentCount?.count || 0),
 trade_count: Number(tradeCount?.count || 0),
 task_count: Number(taskCount?.count || 0),
 benchmark_count: Number(benchmarkCount?.count || 0),
 settlement_health: settlementHealth,
 webhook_health: webhookHealth,
 reference_fleet_execution_health: executionHealth,
 latest_agent: latestAgent || null,
 checked_at: new Date().toISOString(),
 }

 if (!settlementHealth.healthy) {
  logger.warn('Marketplace settlement monitor detected unhealthy transfers', settlementHealth)
 }
 if (!webhookHealth.healthy) logger.warn('Agent webhook monitor detected an unhealthy delivery backlog', webhookHealth)
 if (!executionHealth.healthy) logger.warn('Reference fleet execution monitor detected unhealthy delivery work', executionHealth)

 const webhookUrl = process.env.MONITOR_WEBHOOK_URL
 const notification: { configured: boolean; delivered: boolean; error_id?: string } = {
 configured: Boolean(webhookUrl),
 delivered: false,
 }
 const shouldNotify = !settlementHealth.healthy || !webhookHealth.healthy || !executionHealth.healthy || (stats.agent_count > 0 && Boolean(stats.latest_agent))
 if (webhookUrl && shouldNotify) {
 try {
 const caps = (() => {
 try { return JSON.parse((stats.latest_agent as any)?.capabilities || '[]').join(', ') }
 catch { return 'none' }
 })()
 const response = await safeExternalFetch(webhookUrl, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 signal: AbortSignal.timeout(5_000),
 maxResponseBytes: 64 * 1024,
 body: JSON.stringify({
 content: !settlementHealth.healthy
 ? `🚨 ClawdMarket settlement alert: ${settlementHealth.stuck_count} transfer(s) exceed ${settlementHealth.stuck_after_minutes} minutes; ${settlementHealth.failed_count} failed. Oldest stuck: ${settlementHealth.oldest_stuck_at || 'unknown'}.`
 : !webhookHealth.healthy
 ? `🚨 ClawdMarket webhook alert: ${webhookHealth.failed_count} exhausted, ${webhookHealth.overdue_count} overdue, ${webhookHealth.retrying_count} retrying. Oldest pending: ${webhookHealth.oldest_pending_at || 'unknown'}.`
 : !executionHealth.healthy
 ? `🚨 ClawdMarket managed execution alert: ${executionHealth.untracked_funded_count} untracked funded, ${executionHealth.counts.dead_letter} dead-lettered, ${executionHealth.stale_lease_count} stale leases, ${executionHealth.overdue_retry_count} overdue retries. Oldest pending: ${executionHealth.oldest_pending_at || 'unknown'}.`
 : stats.agent_count === 1
 ? `🚨 **FIRST AGENT ON CLAWDMARKET**\n\nID: ${(stats.latest_agent as any).id}\nName: ${(stats.latest_agent as any).name}\nCapabilities: ${caps}\nOwner: ${(stats.latest_agent as any).owner_address}\nRegistry: https://clawdmkt.com/registry/${(stats.latest_agent as any).id}\n\nPost the X thread now.`
 : `📊 ClawdMarket: ${stats.agent_count} agents, ${stats.trade_count} trades, ${stats.task_count} tasks`,
 }),
 })
 if (!response.ok) throw new Error(`Monitor webhook returned HTTP ${response.status}`)
 notification.delivered = true
 } catch (error) {
 notification.error_id = reportInternalError('Monitor webhook delivery failed', error)
 }
 }

 return NextResponse.json({ ok: settlementHealth.healthy && webhookHealth.healthy && executionHealth.healthy && (!notification.configured || notification.delivered || !shouldNotify), ...stats, notification })

 } catch (err: any) {
 return internalErrorResponse('Marketplace monitor cron failed', err, {
  code: 'monitor_failed',
  message: 'The monitoring run failed. Use the error ID to inspect server logs.',
 })
 }
}
