import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, bids, task_workspaces } from '@/lib/schema'
import { and, eq, ne } from 'drizzle-orm'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { deliverWebhookEvent } from '@/lib/webhook-delivery'
import { getPaymentReadiness } from '@/lib/payment-config'
import { payoutAddressForUser } from '@/lib/external-settlement'

export const dynamic = 'force-dynamic'

export async function POST(
 request: NextRequest,
 { params }: { params: Promise<{ id: string, bid_id: string }> }
) {
 const { id, bid_id } = await params
 const principal = await resolveRequestPrincipal(request)
 if (!principal) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
 if (principal.usesCookieAuth && !validateCsrf(request)) {
  return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
 }

 const task = await db.select().from(tasks)
 .where(eq(tasks.id, id)).get().catch(() => null)

 if (!task) return NextResponse.json({ error: 'not_found' }, { status: 404 })
 if (task.status !== 'open') {
 return NextResponse.json({ error: 'task_not_open' }, { status: 409 })
 }
 const callerIds = new Set([principal.userId, principal.agentId].filter(Boolean))
 if (!callerIds.has(task.posterAgentId)) {
  return NextResponse.json({ error: 'forbidden', message: 'Only the task poster can accept a bid' }, { status: 403 })
 }

 const bid = await db.select().from(bids)
 .where(and(eq(bids.id, bid_id), eq(bids.taskId, id))).get().catch(() => null)

 if (!bid) return NextResponse.json({ error: 'bid_not_found' }, { status: 404 })
 if (bid.status !== 'pending') return NextResponse.json({ error: 'bid_not_pending' }, { status: 409 })
 if (callerIds.has(bid.bidderAgentId)) return NextResponse.json({ error: 'Cannot accept your own bid' }, { status: 409 })
 if (new Date(task.expiresAt).getTime() <= Date.now() || (task.deadlineAt && new Date(task.deadlineAt).getTime() <= Date.now())) {
  return NextResponse.json({ error: 'task_expired' }, { status: 409 })
 }
 if (!getPaymentReadiness().ledger.enabled && !await payoutAddressForUser(`user_agent_${bid.bidderAgentId}`)) {
  return NextResponse.json({
   error: 'seller_payout_address_required',
   message: 'The bidder must set an EVM payout wallet before this task can be accepted and funded.',
   setup_endpoint: '/api/payments/payout-address',
  }, { status: 409 })
 }
 const assigned = await db.transaction(async (tx) => {
  const [currentBid] = await tx.select().from(bids).where(and(eq(bids.id, bid_id), eq(bids.taskId, id), eq(bids.status, 'pending'))).limit(1)
  if (!currentBid) return false
  const [claimed] = await tx.update(tasks)
   .set({ status: 'assigned', assignedAgentId: bid.bidderAgentId, winningBidId: bid_id })
   .where(and(eq(tasks.id, id), eq(tasks.status, 'open')))
   .returning({ id: tasks.id })
  if (!claimed) return false

  // Snapshot the accepted quote so later bid edits cannot change the charge.
  await tx.insert(task_workspaces).values({ task_id: id, agreed_price: currentBid.priceUsd })
   .onConflictDoUpdate({ target: task_workspaces.task_id, set: { agreed_price: currentBid.priceUsd } })

  await tx.update(bids).set({ status: 'accepted' }).where(eq(bids.id, bid_id))
  await tx.update(bids).set({ status: 'rejected' }).where(and(eq(bids.taskId, id), ne(bids.id, bid_id)))
  return true
 })

 if (!assigned) return NextResponse.json({ error: 'task_not_open' }, { status: 409 })
 await Promise.allSettled([
  deliverWebhookEvent(`user_agent_${bid.bidderAgentId}`, 'task.assigned', { task_id: id, bid_id, workspace_url: `/taskboard/${id}` }),
  deliverWebhookEvent(principal.userId, 'task.assigned', { task_id: id, bid_id, assigned_to: bid.bidderAgentId }),
 ])

 return NextResponse.json({
 ok: true,
 task_id: id,
 bid_id,
 assigned_to: bid.bidderAgentId,
 workspace_url: `/taskboard/${id}`,
 funding_required: true,
 })
}
