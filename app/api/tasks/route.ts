import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, bids } from '@/lib/schema'
import { eq, desc, and, sql, gte, lte } from 'drizzle-orm'
import { mppx } from '@/lib/mpp'

export async function GET(request: NextRequest) {
 const { searchParams } = new URL(request.url)
 const capability = searchParams.get('capability')
 const budgetMin = parseFloat(searchParams.get('budget_min') || '0')
 const budgetMax = parseFloat(searchParams.get('budget_max') || '999999')
 const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
 const status = searchParams.get('status') || 'open'

 try {
 const allTasks = await db
 .select({
 id: tasks.id,
 title: tasks.title,
 description: tasks.description,
 required_capabilities: tasks.requiredCapabilities,
 budget_usd: tasks.budgetUsd,
 status: tasks.status,
 created_at: tasks.createdAt,
 expires_at: tasks.expiresAt,
 deadline_at: tasks.deadlineAt,
 poster_agent_id: tasks.posterAgentId,
 assigned_agent_id: tasks.assignedAgentId,
 })
 .from(tasks)
 .where(
 and(
 eq(tasks.status, status),
 gte(tasks.budgetUsd, budgetMin),
 lte(tasks.budgetUsd, budgetMax),
 )
 )
 .orderBy(desc(tasks.createdAt))
 .limit(limit)
 .all()
 .catch(() => [])

 const bidCounts = await db
 .select({
 task_id: bids.taskId,
 count: sql<number>`COUNT(*)`,
 })
 .from(bids)
 .groupBy(bids.taskId)
 .all()
 .catch(() => [])

 const bidMap = new Map(bidCounts.map(b => [b.task_id, b.count]))

 const enriched = allTasks.map(task => ({
 ...task,
 required_capabilities: (() => {
 try { return JSON.parse(task.required_capabilities || '[]') }
 catch { return [] }
 })(),
 bid_count: Number(bidMap.get(task.id) || 0),
 expires_in: getRelativeTime(task.expires_at),
 posted_at: getRelativeTime(task.created_at),
 }))

 const filtered = capability
 ? enriched.filter(t =>
 t.required_capabilities.some((c: string) =>
 c.toLowerCase().includes(capability.toLowerCase())
 )
 )
 : enriched

 return NextResponse.json({
 tasks: filtered,
 total: filtered.length,
 status_filter: status,
 }, { headers: { 'Cache-Control': 'no-store' } })

 } catch (err: any) {
 return NextResponse.json(
 { tasks: [], total: 0, error: err.message },
 { status: 200 }
 )
 }
}

export const POST = mppx.charge({ amount: '0.001' })(
 async (request: NextRequest) => {
 try {
 const body = await request.json()
 const { title, description, required_capabilities, budget_usd, deadline_at } = body

 if (!title || !description || !budget_usd) {
 return NextResponse.json(
 { error: 'invalid_body', message: 'title, description, budget_usd required' },
 { status: 400 }
 )
 }

 const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
 const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
 const receipt = (request as any).mppReceipt
 const posterAgentId = receipt?.payer || 'anonymous'

 await db.insert(tasks).values({
 id,
 posterAgentId,
 title: title.slice(0, 200),
 description: description.slice(0, 2000),
 requiredCapabilities: JSON.stringify(
 Array.isArray(required_capabilities) ? required_capabilities : []
 ),
 budgetUsd: parseFloat(budget_usd),
 deadlineAt: deadline_at || null,
 status: 'open',
 expiresAt,
 createdAt: new Date().toISOString(),
 })

 return NextResponse.json({ ok: true, task_id: id, expires_at: expiresAt })

 } catch (err: any) {
 return NextResponse.json(
 { error: 'task_create_failed', detail: err.message },
 { status: 500 }
 )
 }
 }
)

function getRelativeTime(ts: string | null): string {
 if (!ts) return '—'
 const diff = Date.now() - new Date(ts).getTime()
 const mins = Math.floor(diff / 60000)
 if (mins < 1) return 'just now'
 if (mins < 60) return `${mins}m ago`
 const hrs = Math.floor(mins / 60)
 if (hrs < 24) return `${hrs}h ago`
 return `${Math.floor(hrs / 24)}d ago`
}
