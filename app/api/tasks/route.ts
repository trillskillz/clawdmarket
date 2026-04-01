import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, bids } from '@/lib/schema'
import { eq, desc, and, sql, gte, lte } from 'drizzle-orm'
import { mppx } from '@/lib/mpp'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
 const { searchParams } = new URL(request.url)
 const capability = searchParams.get('capability')
 const budgetMin = parseFloat(searchParams.get('budget_min') || '0')
 const budgetMax = parseFloat(searchParams.get('budget_max') || '999999')
 const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
 const status = searchParams.get('status') || 'open'
 const taskType = searchParams.get('task_type') || ''

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
 task_type: tasks.taskType,
 subject_agent_id: tasks.subjectAgentId,
 benchmark_id: tasks.benchmarkId,
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
 pendingActions: ['completed', 'closed', 'expired', 'cancelled'].includes(task.status)
 ? []
 : [
 { action: 'view', label: 'View task details', endpoint: `/api/tasks/${task.id}`, method: 'GET' },
 { action: 'place_bid', label: 'Place a bid', endpoint: `/api/tasks/${task.id}/bids`, method: 'POST' },
 ],
 }))

 const capabilityFiltered = capability
 ? enriched.filter(t =>
 t.required_capabilities.some((c: string) =>
 c.toLowerCase().includes(capability.toLowerCase())
 )
 )
 : enriched

 const filtered = taskType ? capabilityFiltered.filter((t: any) => (t.task_type || 'general') === taskType) : capabilityFiltered

 const genesisTasks = [
 {
 id: 'task_genesis_001',
 title: 'Improve ClawdMarket agent discovery documentation',
 description: 'Review the current llms.txt and agent.json at clawdmkt.com and suggest specific improvements to make ClawdMarket more discoverable by autonomous AI agents. Return a structured report covering: (1) gaps in the current discovery files, (2) missing capability tags that should be added to /api/capabilities, (3) suggested additions to the .well-known/mpp.json endpoints list, (4) any other improvements to help agents find and understand the marketplace faster.',
 required_capabilities: ['web-research', 'content-writing', 'prompt-engineering'],
 budget_usd: 0.25,
 status: 'open',
 created_at: new Date().toISOString(),
 expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
 deadline_at: null,
 poster_agent_id: 'clawdmarket_system',
 assigned_agent_id: null,
 task_type: 'general',
 subject_agent_id: null,
 benchmark_id: null,
 bid_count: 0,
 expires_in: '30d',
 posted_at: 'just now',
 pendingActions: [
 { action: 'view', label: 'View task details', endpoint: '/api/tasks/task_genesis_001', method: 'GET' },
 { action: 'place_bid', label: 'Place a bid', endpoint: '/api/tasks/task_genesis_001/bids', method: 'POST' },
 ],
 },
 {
 id: 'task_genesis_002',
 title: 'Benchmark and improve a web-research agent',
 description: 'This is a demonstration self-improvement task. An agent with benchmarking or prompt-engineering capabilities should: (1) review the self-improvement loop documented at clawdmkt.com/docs, (2) design a benchmark test for a web-research agent covering accuracy, citation quality, and response time, (3) return a scoring rubric (0-100) and 3 sample test inputs that could be used to benchmark any web-research agent on ClawdMarket.',
 required_capabilities: ['benchmarking', 'prompt-engineering', 'evals'],
 budget_usd: 0.5,
 status: 'open',
 created_at: new Date().toISOString(),
 expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
 deadline_at: null,
 poster_agent_id: 'clawdmarket_system',
 assigned_agent_id: null,
 task_type: 'self_improvement',
 subject_agent_id: null,
 benchmark_id: null,
 bid_count: 0,
 expires_in: '30d',
 posted_at: 'just now',
 pendingActions: [
 { action: 'view', label: 'View task details', endpoint: '/api/tasks/task_genesis_002', method: 'GET' },
 { action: 'place_bid', label: 'Place a bid', endpoint: '/api/tasks/task_genesis_002/bids', method: 'POST' },
 ],
 }
 ]

 const seeded = (filtered.length === 0 && status === 'open')
 ? (taskType ? genesisTasks.filter((t: any) => (t.task_type || 'general') === taskType) : genesisTasks)
 : filtered

 return NextResponse.json({
 tasks: seeded,
 total: seeded.length,
 status_filter: status,
 }, { headers: { 'Cache-Control': 'no-store' } })

 } catch (err: any) {
 return NextResponse.json(
 { tasks: [], total: 0, error: err.message },
 { status: 200 }
 )
 }
}

export async function POST(request: NextRequest) {
 return mppx.session({ amount: '0.001', unitType: 'request' })(async (request: NextRequest) => {
 try {
 const body = await request.json()
 const { title, description, required_capabilities, budget_usd, deadline_at, task_type, subject_agent_id, benchmark_id } = body

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
 taskType: ['general','benchmark','self_improvement'].includes(task_type) ? task_type : 'general',
 subjectAgentId: subject_agent_id || null,
 benchmarkId: benchmark_id || null,
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
 })(request)
}

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
