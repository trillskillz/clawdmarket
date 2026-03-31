import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, bids } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
import { mppx } from '@/lib/mpp'

export const GET = mppx.session({ amount: '0.001', unitType: 'request' })(
 async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
 const { id } = await params
 const task = await db.select().from(tasks)
 .where(eq(tasks.id, id)).get().catch(() => null)

 if (!task) {
 return NextResponse.json({ error: 'not_found' }, { status: 404 })
 }

 const taskBids = await db.select().from(bids)
 .where(eq(bids.taskId, id))
 .orderBy(desc(bids.createdAt))
 .all().catch(() => [])

 return NextResponse.json({
 ...task,
 required_capabilities: (() => {
 try { return JSON.parse(task.requiredCapabilities || '[]') }
 catch { return [] }
 })(),
 bids: taskBids,
 bid_count: taskBids.length,
 })
 }
)
