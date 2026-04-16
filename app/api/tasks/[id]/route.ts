import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, bids } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
import { mppx } from '@/lib/mpp'
import { getTaskPendingActions } from '@/lib/agent-contract'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return mppx.session({ amount: '0.001', unitType: 'request' })(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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

    const callerAgentId = (request as any).mppReceipt?.payer || null

    return NextResponse.json({
      ...task,
      required_capabilities: (() => {
        try { return JSON.parse(task.requiredCapabilities || '[]') }
        catch { return [] }
      })(),
      bids: taskBids,
      bid_count: taskBids.length,
      pendingActions: getTaskPendingActions(task, taskBids, callerAgentId),
    })
  })(request, { params })
}
