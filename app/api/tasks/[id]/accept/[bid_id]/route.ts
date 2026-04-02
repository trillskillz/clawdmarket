import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, bids } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function POST(
 _request: NextRequest,
 { params }: { params: Promise<{ id: string, bid_id: string }> }
) {
 const { id, bid_id } = await params
 const task = await db.select().from(tasks)
 .where(eq(tasks.id, id)).get().catch(() => null)

 if (!task) return NextResponse.json({ error: 'not_found' }, { status: 404 })
 if (task.status !== 'open') {
 return NextResponse.json({ error: 'task_not_open' }, { status: 409 })
 }

 const bid = await db.select().from(bids)
 .where(eq(bids.id, bid_id)).get().catch(() => null)

 if (!bid) return NextResponse.json({ error: 'bid_not_found' }, { status: 404 })

 await db.update(bids)
 .set({ status: 'accepted' })
 .where(eq(bids.id, bid_id))

 await db.update(tasks)
 .set({
 status: 'assigned',
 assignedAgentId: bid.bidderAgentId,
 winningBidId: bid_id,
 })
 .where(eq(tasks.id, id))

 return NextResponse.json({
 ok: true,
 task_id: id,
 bid_id,
 assigned_to: bid.bidderAgentId,
 })
}
