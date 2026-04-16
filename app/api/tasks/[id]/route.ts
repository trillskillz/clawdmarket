import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, bids } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
import { mppx } from '@/lib/mpp'

export const dynamic = 'force-dynamic'

type PendingAction = {
  action: string
  label: string
  endpoint: string
  method: string
  auth?: string
  payment?: null | Record<string, unknown>
  body_schema?: Record<string, unknown>
  target_bid_id?: string
}

function getPendingActions(task: any, taskBids: any[], callerAgentId: string | null): PendingAction[] {
  const closed = ['completed', 'closed', 'expired', 'cancelled'].includes(task.status)
  if (closed) return []

  const isOwner = callerAgentId && callerAgentId === task.posterAgentId
  if (isOwner) {
    const actions: PendingAction[] = [
      viewTaskAction(task.id),
    ]
    const openBids = taskBids.filter(b => b.status === 'pending')
    for (const bid of openBids) {
      actions.push({
        action: 'accept_bid',
        label: `Accept bid ${bid.id}`,
        endpoint: `/api/tasks/${task.id}/accept/${bid.id}`,
        method: 'POST',
        auth: 'task-owner',
        payment: null,
        target_bid_id: bid.id,
      })
    }
    return actions
  }

  const myBid = callerAgentId ? taskBids.find(b => b.bidderAgentId === callerAgentId) : null
  if (myBid) {
    const actions: PendingAction[] = []
    if (myBid.status === 'pending') {
      actions.push(viewTaskAction(task.id))
    }
    return actions
  }

  return [
    viewTaskAction(task.id),
    placeBidAction(task.id),
  ]
}

function viewTaskAction(taskId: string): PendingAction {
  return {
    action: 'view',
    label: 'View task details',
    endpoint: `/api/tasks/${taskId}`,
    method: 'GET',
    auth: 'none',
    payment: null,
  }
}

function placeBidAction(taskId: string): PendingAction {
  return {
    action: 'place_bid',
    label: 'Place a bid',
    endpoint: `/api/tasks/${taskId}/bid`,
    method: 'POST',
    auth: 'mpp-session',
    payment: { protocol: 'mpp', amount_usd: 0.001 },
    body_schema: {
      type: 'object',
      required: ['price_usd'],
      properties: {
        price_usd: { type: 'number' },
        message: { type: 'string', maxLength: 500 },
        eta_seconds: { type: 'integer' },
      },
    },
  }
}

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
      pendingActions: getPendingActions(task, taskBids, callerAgentId),
    })
  })(request, { params })
}
