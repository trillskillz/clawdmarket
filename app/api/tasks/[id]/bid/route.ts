import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, bids } from '@/lib/schema'
import { eq, and } from 'drizzle-orm'
import { mppx } from '@/lib/mpp'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { getAgentUsageCounts, getFeatureQuota, paymentRequiredForQuota, recordAgentUsageEvent, usageHeaders } from '@/lib/agent-usage-policy'

export const dynamic = 'force-dynamic'

function parseBidBody(body: any) {
 const priceUsd = Number(body?.price_usd)
 if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
  return { error: 'price_usd required' as const }
 }

 let etaSeconds: number | null = null
 if (body?.eta_seconds !== undefined && body?.eta_seconds !== null && body?.eta_seconds !== '') {
  etaSeconds = Number.parseInt(String(body.eta_seconds), 10)
  if (!Number.isFinite(etaSeconds) || etaSeconds < 0) {
   return { error: 'eta_seconds must be a non-negative integer' as const }
  }
 }

 const message = typeof body?.message === 'string' && body.message.trim().length > 0
  ? body.message.trim().slice(0, 500)
  : null

 return { priceUsd, message, etaSeconds }
}

async function resolveBearerBidder(request: NextRequest) {
 const agentAuth = await resolveRegisteredAgentRequest(request)
 return agentAuth.kind === 'agent'
  ? { kind: 'agent' as const, agentId: agentAuth.agentId }
  : agentAuth
}

function resolveMppBidder(request: NextRequest) {
 const receipt = (request as any).mppReceipt
 const payer = receipt?.payer || receipt?.payerAddress || receipt?.from || receipt?.account
 return typeof payer === 'string' && payer.trim().length > 0 ? payer.trim() : ''
}

async function createBid(taskId: string, body: any, bidderAgentId: string) {
 const parsed = parseBidBody(body)
 if ('error' in parsed) {
  return NextResponse.json(
   { error: 'invalid_body', message: parsed.error },
   { status: 400 }
  )
 }

 const task = await db.select().from(tasks)
  .where(eq(tasks.id, taskId)).get().catch(() => null)

 if (!task) return NextResponse.json({ error: 'not_found' }, { status: 404 })
 if (task.status !== 'open') {
  return NextResponse.json(
   { error: 'task_not_open', message: 'Task is no longer accepting bids' },
   { status: 409 }
  )
 }

 const existing = await db.select({ id: bids.id }).from(bids)
  .where(and(eq(bids.taskId, taskId), eq(bids.bidderAgentId, bidderAgentId)))
  .get().catch(() => null)

 if (existing) {
  return NextResponse.json(
   { error: 'duplicate', message: 'Already bid on this task' },
   { status: 409 }
  )
 }

 const id = `bid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

 await db.insert(bids).values({
  id,
  taskId,
  bidderAgentId,
  priceUsd: parsed.priceUsd,
  message: parsed.message,
  etaSeconds: parsed.etaSeconds,
  status: 'pending',
  createdAt: new Date().toISOString(),
 })

 return NextResponse.json({ ok: true, bid_id: id, bidder_agent_id: bidderAgentId })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 const { id: taskId } = await params
 const body = await request.clone().json().catch(() => ({}))

 try {
  const bearerBidder = await resolveBearerBidder(request)
  if (bearerBidder.kind === 'agent') {
   const rateLimitResult = await rateLimit(`bid-task:${bearerBidder.agentId}`, {
    interval: 60 * 1000,
    maxRequests: 30,
   })

   if (!rateLimitResult.success) {
    return NextResponse.json(
     { error: 'rate_limited', message: 'Too many bid attempts. Please try again later.' },
     { status: 429, headers: getRateLimitHeaders(rateLimitResult) }
    )
   }

   const usage = await getAgentUsageCounts(bearerBidder.agentId)
   const quota = getFeatureQuota(usage, 'task_bids')
   if (!quota.over_quota) {
    const response = await createBid(taskId, body, bearerBidder.agentId)
    const wroteBid = response.status >= 200 && response.status < 300
    if (wroteBid) {
     await recordAgentUsageEvent({
      agentId: bearerBidder.agentId,
      feature: 'task_bids',
      eventType: 'free_write',
      route: 'POST /api/tasks/:id/bid',
     })
    }
    const nextQuota = wroteBid ? { ...quota, used: quota.used + 1, remaining_free: Math.max(0, quota.remaining_free - 1) } : quota
    Object.entries({ ...getRateLimitHeaders(rateLimitResult), ...usageHeaders(nextQuota) })
     .forEach(([key, value]) => response.headers.set(key, value))
    return response
   }

   await recordAgentUsageEvent({
    agentId: bearerBidder.agentId,
    feature: 'task_bids',
    eventType: 'overage_challenge',
    route: 'POST /api/tasks/:id/bid',
    amountUsd: 0.001,
   })

   return mppx.session({ amount: '0.001', unitType: 'request' })(async (gatedRequest: NextRequest) => {
    const payer = resolveMppBidder(gatedRequest)
    if (!payer) return paymentRequiredForQuota(quota)
    const response = await createBid(taskId, body, bearerBidder.agentId)
    if (response.status >= 200 && response.status < 300) {
     await recordAgentUsageEvent({
      agentId: bearerBidder.agentId,
      feature: 'task_bids',
      eventType: 'paid_conversion',
      route: 'POST /api/tasks/:id/bid',
      payer,
      amountUsd: 0.001,
     })
    }
    return response
   })(request, { params: Promise.resolve({ id: taskId }) })
  }
  if (bearerBidder.kind === 'invalid') {
   return NextResponse.json(
    { error: 'unauthorized', message: 'Invalid agent API key' },
    { status: 401 }
   )
  }

  return mppx.session({ amount: '0.001', unitType: 'request' })(async (gatedRequest: NextRequest) => {
   const bidderAgentId = resolveMppBidder(gatedRequest)
   if (!bidderAgentId) {
    return NextResponse.json(
     { error: 'payment_required', message: 'Provide an agent API key or a valid MPP payment receipt' },
     { status: 402 }
    )
   }

   return createBid(taskId, body, bidderAgentId)
  })(request, { params: Promise.resolve({ id: taskId }) })
 } catch (err: any) {
  console.error('[tasks/bid]', err)
  return NextResponse.json(
   { error: 'internal_error', message: err?.message || 'Failed to create bid' },
   { status: 500 }
  )
 }
}
