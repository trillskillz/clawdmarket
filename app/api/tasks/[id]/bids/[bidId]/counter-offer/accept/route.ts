import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; bidId: string }> }
) {
  try {
    const { id: taskId, bidId } = await params
    const client = (db as any).$client

    // Verify bid exists with a pending counter-offer
    const bidRes = await client.execute({
      sql: `SELECT id, task_id, counter_offer_price, counter_offer_status FROM bids WHERE id = ? AND task_id = ?`,
      args: [bidId, taskId],
    })
    if (!bidRes?.rows?.length) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 })
    }

    const bid = bidRes.rows[0] as any
    if (bid.counter_offer_status !== 'pending') {
      return NextResponse.json({ error: 'No pending counter-offer to accept' }, { status: 400 })
    }

    await client.execute({
      sql: `UPDATE bids SET price_usd = counter_offer_price, counter_offer_status = 'accepted', status = 'accepted' WHERE id = ?`,
      args: [bidId],
    })

    const updatedRes = await client.execute({
      sql: `SELECT * FROM bids WHERE id = ?`,
      args: [bidId],
    })

    return NextResponse.json({
      ok: true,
      bid: updatedRes?.rows?.[0] || null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
