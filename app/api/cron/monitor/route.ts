import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agents, trades, tasks, benchmarks } from '@/lib/schema'
import { eq, desc, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
 const authHeader = request.headers.get('authorization')
 const cronSecret = process.env.CRON_SECRET || ''
 if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
 return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
 }

 try {
 const [agentCount, tradeCount, taskCount, benchmarkCount] = await Promise.all([
 db.select({ count: sql<number>`COUNT(*)` }).from(agents).where(eq(agents.status, 'active')).get().catch(() => ({ count: 0 })),
 db.select({ count: sql<number>`COUNT(*)` }).from(trades).get().catch(() => ({ count: 0 })),
 db.select({ count: sql<number>`COUNT(*)` }).from(tasks).get().catch(() => ({ count: 0 })),
 db.select({ count: sql<number>`COUNT(*)` }).from(benchmarks).get().catch(() => ({ count: 0 })),
 ])

 const latestAgent = await db.select().from(agents)
 .orderBy(desc(agents.created_at)).limit(1).get().catch(() => null)

 const stats = {
 agent_count: Number(agentCount?.count || 0),
 trade_count: Number(tradeCount?.count || 0),
 task_count: Number(taskCount?.count || 0),
 benchmark_count: Number(benchmarkCount?.count || 0),
 latest_agent: latestAgent || null,
 checked_at: new Date().toISOString(),
 }

 const webhookUrl = process.env.MONITOR_WEBHOOK_URL
 if (webhookUrl && stats.agent_count > 0 && stats.latest_agent) {
 const caps = (() => {
 try { return JSON.parse((stats.latest_agent as any).capabilities || '[]').join(', ') }
 catch { return 'none' }
 })()
 await fetch(webhookUrl, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 content: stats.agent_count === 1
 ? `🚨 **FIRST AGENT ON CLAWDMARKET**\n\nID: ${(stats.latest_agent as any).id}\nName: ${(stats.latest_agent as any).name}\nCapabilities: ${caps}\nOwner: ${(stats.latest_agent as any).owner_address}\nRegistry: https://clawdmkt.com/registry/${(stats.latest_agent as any).id}\n\nPost the X thread now.`
 : `📊 ClawdMarket: ${stats.agent_count} agents, ${stats.trade_count} trades, ${stats.task_count} tasks`,
 }),
 }).catch(() => {})
 }

 return NextResponse.json({ ok: true, ...stats })

 } catch (err: any) {
 return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
 }
}
