import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, bids } from '@/lib/schema'
import { eq, desc, and, sql, gte, lte } from 'drizzle-orm'
import { mppx } from '@/lib/mpp'
import { getTaskPendingActions } from '@/lib/agent-contract'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { getAgentUsageCounts, getFeatureQuota, paymentRequiredForQuota, usageHeaders } from '@/lib/agent-usage-policy'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
 const { searchParams } = new URL(request.url)
 const capability = searchParams.get('capability')
 const budgetMin = parseFloat(searchParams.get('budget_min') || '0')
 const budgetMax = parseFloat(searchParams.get('budget_max') || '999999')
 const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
 const status = searchParams.get('status') || 'open'
 const taskType = searchParams.get('task_type') || ''
 const qParam = searchParams.get('q')?.trim().slice(0, 500) || ''

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

 // Fetch bids with pending counter-offers
 let counterOfferMap = new Map<string, any[]>()
 try {
 const coResult = await (db as any).$client.execute({
 sql: `SELECT task_id, id as bid_id, counter_offer_price, counter_offer_status, bidder_agent_id, price_usd
       FROM bids WHERE counter_offer_status = 'pending'`,
 args: [],
 })
 for (const row of (coResult?.rows || [])) {
 const r = row as any
 const list = counterOfferMap.get(r.task_id) || []
 list.push({ bid_id: r.bid_id, counter_offer_price: r.counter_offer_price, counter_offer_status: r.counter_offer_status, bidder_agent_id: r.bidder_agent_id, price_usd: r.price_usd })
 counterOfferMap.set(r.task_id, list)
 }
 } catch { /* counter_offer columns may not exist yet */ }

 const enriched = allTasks.map(task => ({
 ...task,
 required_capabilities: (() => {
 try { return JSON.parse(task.required_capabilities || '[]') }
 catch { return [] }
 })(),
 bid_count: Number(bidMap.get(task.id) || 0),
 counter_offers: counterOfferMap.get(task.id) || [],
 expires_in: getTimeUntil(task.expires_at),
 posted_at: getRelativeTime(task.created_at),
 pendingActions: ['completed', 'closed', 'expired', 'cancelled'].includes(task.status)
 ? []
 : getTaskPendingActions(task),
 }))

 const capabilityFiltered = capability
 ? enriched.filter(t =>
 t.required_capabilities.some((c: string) =>
 c.toLowerCase().includes(capability.toLowerCase())
 )
 )
 : enriched

 // Keyword search via q parameter
 const qFiltered = qParam
 ? (() => {
 const keywords = qParam.toLowerCase().split(/\s+/).filter(w => w.length > 2)
 if (keywords.length === 0) return capabilityFiltered
 return capabilityFiltered.filter((t: any) =>
 keywords.some(kw =>
 (t.title || '').toLowerCase().includes(kw) ||
 (t.description || '').toLowerCase().includes(kw) ||
 (t.required_capabilities || []).some((c: string) => c.toLowerCase().includes(kw))
 )
 )
 })()
 : capabilityFiltered

 const filtered = taskType ? qFiltered.filter((t: any) => (t.task_type || 'general') === taskType) : qFiltered

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
 pendingActions: getTaskPendingActions({ id: 'task_genesis_001', status: 'open' }),
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
 pendingActions: getTaskPendingActions({ id: 'task_genesis_002', status: 'open' }),
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

function resolveMppPoster(request: NextRequest) {
 const receipt = (request as any).mppReceipt
 const payer = receipt?.payer || receipt?.payerAddress || receipt?.from || receipt?.account
 return typeof payer === 'string' && payer.trim().length > 0 ? payer.trim() : ''
}

async function createTask(body: any, posterAgentId: string) {
 const { title, description, required_capabilities, budget_usd, deadline_at, task_type, subject_agent_id, benchmark_id } = body

 if (!title || !description || !budget_usd) {
 return NextResponse.json(
 { error: 'invalid_body', message: 'title, description, budget_usd required' },
 { status: 400 }
 )
 }

 const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
 const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
 const budgetUsd = Number(budget_usd)

 if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
 return NextResponse.json(
 { error: 'invalid_body', message: 'budget_usd must be a positive number' },
 { status: 400 }
 )
 }

 await db.insert(tasks).values({
 id,
 posterAgentId,
 title: title.slice(0, 200),
 description: description.slice(0, 2000),
 requiredCapabilities: JSON.stringify(
 Array.isArray(required_capabilities) ? required_capabilities : []
 ),
 budgetUsd,
 deadlineAt: deadline_at || null,
 status: 'open',
 taskType: ['general','benchmark','self_improvement'].includes(task_type) ? task_type : 'general',
 subjectAgentId: subject_agent_id || null,
 benchmarkId: benchmark_id || null,
 expiresAt,
 createdAt: new Date().toISOString(),
 })

 return NextResponse.json({ ok: true, task_id: id, poster_agent_id: posterAgentId, expires_at: expiresAt })
}

export async function POST(request: NextRequest) {
 const body = await request.clone().json().catch(() => ({}))

 try {
 const agentAuth = await resolveRegisteredAgentRequest(request)
 if (agentAuth.kind === 'agent') {
 const rateLimitResult = await rateLimit(`create-task:${agentAuth.agentId}`, {
 interval: 60 * 1000,
 maxRequests: 10,
 })

 if (!rateLimitResult.success) {
 return NextResponse.json(
 { error: 'rate_limited', message: 'Too many task creation attempts. Please try again later.' },
 { status: 429, headers: getRateLimitHeaders(rateLimitResult) },
 )
 }

 const usage = await getAgentUsageCounts(agentAuth.agentId)
 const quota = getFeatureQuota(usage, 'task_posts')
 if (!quota.over_quota) {
 const response = await createTask(body, agentAuth.agentId)
 const nextQuota = { ...quota, used: quota.used + 1, remaining_free: Math.max(0, quota.remaining_free - 1) }
 Object.entries({ ...getRateLimitHeaders(rateLimitResult), ...usageHeaders(nextQuota) })
 .forEach(([key, value]) => response.headers.set(key, value))
 return response
 }

 return mppx.session({ amount: '0.001', unitType: 'request' })(async (gatedRequest: NextRequest) => {
 const payer = resolveMppPoster(gatedRequest)
 if (!payer) return paymentRequiredForQuota(quota)
 return createTask(body, agentAuth.agentId)
 })(request)
 }
 if (agentAuth.kind === 'invalid') {
 return NextResponse.json(
 { error: 'unauthorized', message: 'Invalid agent API key' },
 { status: 401 }
 )
 }

 return mppx.session({ amount: '0.001', unitType: 'request' })(async (gatedRequest: NextRequest) => {
 const posterAgentId = resolveMppPoster(gatedRequest)
 if (!posterAgentId) {
 return NextResponse.json(
 { error: 'payment_required', message: 'Provide an agent API key or a valid MPP payment receipt' },
 { status: 402 }
 )
 }

 return createTask(body, posterAgentId)
 })(request)

 } catch (err: any) {
 return NextResponse.json(
 { error: 'task_create_failed', detail: err.message },
 { status: 500 }
 )
 }
}

function toDateSafe(ts: string | number): Date {
 if (typeof ts === 'number') {
  return new Date(ts <= 9999999999 ? ts * 1000 : ts)
 }
 if (/^\d+$/.test(ts)) {
  const n = Number(ts)
  return new Date(n <= 9999999999 ? n * 1000 : n)
 }
 return new Date(ts)
}

function getRelativeTime(ts: string | number | null): string {
 if (!ts) return '—'
 const diff = Date.now() - toDateSafe(ts).getTime()
 const mins = Math.floor(diff / 60000)
 if (mins < 1) return 'just now'
 if (mins < 60) return `${mins}m ago`
 const hrs = Math.floor(mins / 60)
 if (hrs < 24) return `${hrs}h ago`
 return `${Math.floor(hrs / 24)}d ago`
}

function getTimeUntil(ts: string | number | null): string {
 if (!ts) return '—'
 const diff = toDateSafe(ts).getTime() - Date.now()
 if (diff <= 0) return 'expired'
 const mins = Math.floor(diff / 60000)
 if (mins < 60) return `${mins}m`
 const hrs = Math.floor(mins / 60)
 if (hrs < 24) return `${hrs}h`
 return `${Math.floor(hrs / 24)}d`
}
