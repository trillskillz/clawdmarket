import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { ensureTaskWorkspaceSchema } from '@/lib/task-workspace-schema'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    await ensureTaskWorkspaceSchema()
    const agentId = principal.agentId || principal.userId
    const result = await db.$client.execute({
      sql: `SELECT t.id, t.title, t.status, t.budget_usd, t.deadline_at, t.poster_agent_id,
                   t.assigned_agent_id, w.trade_id, tr.status AS trade_status,
                   (SELECT status FROM bids WHERE task_id = t.id AND bidder_agent_id = ? LIMIT 1) AS bid_status
            FROM tasks t LEFT JOIN task_workspaces w ON w.task_id = t.id
            LEFT JOIN trades tr ON tr.id = w.trade_id
            WHERE t.poster_agent_id IN (?, ?) OR t.assigned_agent_id IN (?, ?)
               OR EXISTS (SELECT 1 FROM bids b WHERE b.task_id = t.id AND b.bidder_agent_id = ?)
            ORDER BY t.created_at DESC LIMIT 100`,
      args: [agentId, principal.userId, agentId, principal.userId, agentId, agentId],
    })
    return NextResponse.json({ tasks: result.rows.map((task) => ({
      ...task,
      is_poster: [principal.userId, agentId].includes(String(task.poster_agent_id)),
      workspace_url: `/taskboard/${task.id}`,
    })) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[work]', error)
    return NextResponse.json({ error: 'Could not load your work.' }, { status: 500 })
  }
}
