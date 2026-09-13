import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; bidId: string }> }
) {
  try {
    const { id: taskId, bidId } = await params
    const client = (db as any).$client
    const principal = await resolveRequestPrincipal(req)
    if (!principal) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    if (principal.usesCookieAuth && !validateCsrf(req)) {
      return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    }

    // Verify bid exists with a pending counter-offer
    const bidRes = await client.execute({
      sql: `SELECT id, task_id, bidder_agent_id, counter_offer_price, counter_offer_status FROM bids WHERE id = ? AND task_id = ?`,
      args: [bidId, taskId],
    })
    if (!bidRes?.rows?.length) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 })
    }

    const bid = bidRes.rows[0] as any
    if (![principal.userId, principal.agentId].filter(Boolean).includes(String(bid.bidder_agent_id))) {
      return NextResponse.json({ error: 'forbidden', message: 'Only the bidder can accept this counter-offer' }, { status: 403 })
    }
    if (bid.counter_offer_status !== 'pending') {
      return NextResponse.json({ error: 'No pending counter-offer to accept' }, { status: 400 })
    }

    const update = await client.execute({
      sql: `UPDATE bids SET price_usd = counter_offer_price, counter_offer_status = 'accepted'
            WHERE id = ? AND task_id = ? AND counter_offer_status = 'pending' AND status = 'pending'
            AND EXISTS (SELECT 1 FROM tasks WHERE tasks.id = bids.task_id AND tasks.status = 'open')`,
      args: [bidId, taskId],
    })
    if (update.rowsAffected !== 1) return NextResponse.json({ error: 'The bid is no longer open for negotiation' }, { status: 409 })

    const updatedRes = await client.execute({
      sql: `SELECT * FROM bids WHERE id = ?`,
      args: [bidId],
    })

    return NextResponse.json({
      ok: true,
      bid: updatedRes?.rows?.[0] || null,
    })
  } catch (err: any) {
    return internalErrorResponse('Task counter-offer acceptance failed', err)
  }
}
