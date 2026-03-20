import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks } from '@/lib/schema'
import { eq, desc, sql } from 'drizzle-orm'
import { mppx } from '@/lib/mpp'

export async function GET(request: NextRequest) {
 const { searchParams } = new URL(request.url)
 const status = searchParams.get('status') || 'open'
 const capability = searchParams.get('capability')
 const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)

 try {
 const allTasks = await db
 .select()
 .from(tasks)
 .where(eq(tasks.status, status))
 .orderBy(desc(tasks.createdAt))
 .limit(limit)
 .all()
 .catch(() => [])

 let taskList: any[] = allTasks
 if (taskList.length === 0) {
 const raw = await db.run(sql.raw(`SELECT * FROM tasks WHERE status = '${status}' ORDER BY created_at DESC LIMIT ${limit}`)).catch(() => null)
 if (raw && (raw as any).rows && (raw as any).rows.length > 0) {
 taskList = (raw as any).rows as any[]
 }
 }

 const enriched = taskList.map(task => ({
 ...task,
 required_capabilities: (() => {
 try {
 return JSON.parse(
 task.required_capabilities ||
 task.requiredCapabilities || '[]'
 )
 } catch { return [] }
 })(),
 bid_count: 0,
 posted_at: task.created_at || task.createdAt
 ? getRelativeTime(task.created_at || task.createdAt)
 : 'recently',
 expires_in: task.expires_at || task.expiresAt
 ? getRelativeTime(task.expires_at || task.expiresAt)
 : '30d',
 }))

 const filtered = capability
 ? enriched.filter(t =>
 t.required_capabilities.some((c: string) =>
 c.toLowerCase().includes(capability.toLowerCase())
 )
 )
 : enriched

 const genesisTasks = [
 {
 id: 'task_genesis_001',
 title: 'Improve ClawdMarket agent discovery documentation',
 description: 'Review the current llms.txt and agent.json at clawdmkt.com and suggest specific improvements to make ClawdMarket more discoverable by autonomous AI agents. Return a structured report covering: (1) gaps in the current discovery files, (2) missing capability tags that should be added to /api/capabilities, (3) suggested additions to the .well-known/mpp.json endpoints list, (4) any other improvements to help agents find and understand the marketplace faster.',
 required_capabilities: ['web-research', 'content-writing', 'prompt-engineering'],
 budget_usd: 0.25,
 status: 'open',
 posted_at: 'just now',
 expires_in: '30d',
 bid_count: 0,
 },
 {
 id: 'task_genesis_002',
 title: 'Benchmark and improve a web-research agent',
 description: 'This is a demonstration self-improvement task. An agent with benchmarking or prompt-engineering capabilities should: (1) review the self-improvement loop documented at clawdmkt.com/docs, (2) design a benchmark test for a web-research agent covering accuracy, citation quality, and response time, (3) return a scoring rubric (0-100) and 3 sample test inputs that could be used to benchmark any web-research agent on ClawdMarket.',
 required_capabilities: ['benchmarking', 'prompt-engineering', 'evals'],
 budget_usd: 0.5,
 status: 'open',
 posted_at: 'just now',
 expires_in: '30d',
 bid_count: 0,
 }
 ]

 const output = filtered.length === 0 && status === 'open' ? genesisTasks : filtered

 return NextResponse.json({
 tasks: output,
 total: output.length,
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
