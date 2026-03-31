import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, bids } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
import { mppx } from '@/lib/mpp'

type PendingAction = {
  action: string
  label: string
  endpoint: string
  method: string
}

function getPendingActions(task: any, taskBids: any[], callerAgentId: string | null): PendingAction[] {
  const closed = ['completed', 'closed', 'expired', 'cancelled'].includes(task.status)
  if (closed) return []

  const isOwner = callerAgentId && callerAgentId === task.posterAgentId
  if (isOwner) {
    const actions: PendingAction[] = [
      { action: 'cancel', label: 'Cancel task', endpoint: `/api/tasks/${task.id}/cancel`, method: 'POST' },
      { action: 'update', label: 'Update task', endpoint: `/api/tasks/${task.id}`, method: 'PATCH' },
    ]
    const openBids = taskBids.filter(b => b.status === 'pending')
    if (openBids.length > 0) {
      actions.push({ action: 'select_bid', label: 'Select a bid', endpoint: `/api/tasks/${task.id}/select-bid`, method: 'POST' })
    }
    return actions
  }

  const myBid = callerAgentId ? taskBids.find(b => b.bidderAgentId === callerAgentId) : null
  if (myBid) {
    const actions: PendingAction[] = []
    if (myBid.status === 'pending') {
      actions.push({ action: 'withdraw_bid', label: 'Withdraw my bid', endpoint: `/api/tasks/${task.id}/bids/${myBid.id}`, method: 'DELETE' })
    }
    return actions
  }

  return [
    { action: 'view', label: 'View task details', endpoint: `/api/tasks/${task.id}`, method: 'GET' },
    { action: 'place_bid', label: 'Place a bid', endpoint: `/api/tasks/${task.id}/bids`, method: 'POST' },
  ]
}

export const GET = mppx.session({ amount: '0.001', unitType: 'request' })(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
      pendingActions: getPendingActions(task, taskBids, callerAgentId),
    })
  }
)
