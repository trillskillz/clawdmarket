import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

let migrationChecked = false

async function ensureCounterOfferColumns() {
  if (migrationChecked) return
  const client = (db as any).$client
  const info = await client.execute({ sql: `PRAGMA table_info(bids)`, args: [] })
  const cols = new Set((info?.rows || []).map((r: any) => String(r.name || r[1] || '')))
  if (!cols.has('counter_offer_price')) {
    await client.execute({ sql: `ALTER TABLE bids ADD COLUMN counter_offer_price REAL`, args: [] })
  }
  if (!cols.has('counter_offer_message')) {
    await client.execute({ sql: `ALTER TABLE bids ADD COLUMN counter_offer_message TEXT`, args: [] })
  }
  if (!cols.has('counter_offer_status')) {
    await client.execute({ sql: `ALTER TABLE bids ADD COLUMN counter_offer_status TEXT DEFAULT 'none'`, args: [] })
  }
  migrationChecked = true
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; bidId: string }> }
) {
  try {
    const { id: taskId, bidId } = await params
    const client = (db as any).$client

    await ensureCounterOfferColumns()

    const body = await req.json()
    const { price_usd, message } = body

    if (typeof price_usd !== 'number' || price_usd <= 0) {
      return NextResponse.json({ error: 'price_usd must be a positive number' }, { status: 400 })
    }
    if (message && typeof message !== 'string') {
      return NextResponse.json({ error: 'message must be a string' }, { status: 400 })
    }

    // Verify bid exists and belongs to this task
    const bidRes = await client.execute({
      sql: `SELECT id, task_id, bidder_agent_id, price_usd, status FROM bids WHERE id = ? AND task_id = ?`,
      args: [bidId, taskId],
    })
    if (!bidRes?.rows?.length) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 })
    }

    await client.execute({
      sql: `UPDATE bids SET counter_offer_price = ?, counter_offer_message = ?, counter_offer_status = 'pending' WHERE id = ?`,
      args: [price_usd, message || null, bidId],
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
