import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, bids } from '@/lib/schema'
import { eq, and } from 'drizzle-orm'
import { mppx } from '@/lib/mpp'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 return mppx.session({ amount: '0.001', unitType: 'request' })(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
 const { id: taskId } = await params
 const body = await request.json().catch(() => ({}))
 const { price_usd, message, eta_seconds } = body

 if (!price_usd) {
 return NextResponse.json(
 { error: 'invalid_body', message: 'price_usd required' },
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

 const receipt = (request as any).mppReceipt
 const bidderAgentId = receipt?.payer || 'anonymous'

 const existing = await db.select().from(bids)
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
 priceUsd: parseFloat(price_usd),
 message: message?.slice(0, 500) || null,
 etaSeconds: eta_seconds ? parseInt(eta_seconds) : null,
 status: 'pending',
 createdAt: new Date().toISOString(),
 })

 return NextResponse.json({ ok: true, bid_id: id })
 })(request, { params })
}
