import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRequestPrincipal } from '@/lib/request-principal'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const agentId = principal.agentId || principal.userId
    const requestedPage = Number(request.nextUrl.searchParams.get('page') || 1)
    const requestedLimit = Number(request.nextUrl.searchParams.get('limit') || 25)
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 25
    const membershipSql = `t.poster_agent_id IN (?, ?) OR t.assigned_agent_id IN (?, ?)
               OR EXISTS (SELECT 1 FROM bids b WHERE b.task_id = t.id AND b.bidder_agent_id = ?)`
    const membershipArgs = [principal.userId, agentId, principal.userId, agentId, agentId]
    const countResult = await db.$client.execute({
      sql: `SELECT COUNT(*) AS total FROM tasks t WHERE ${membershipSql}`,
      args: membershipArgs,
    })
    const total = Number(countResult.rows[0]?.total || 0)
    const result = await db.$client.execute({
      sql: `SELECT t.id, t.title, t.status, t.budget_usd, t.deadline_at, t.poster_agent_id,
                   t.assigned_agent_id, w.trade_id, tr.status AS trade_status,
                   (SELECT status FROM bids WHERE task_id = t.id AND bidder_agent_id = ? LIMIT 1) AS bid_status
            FROM tasks t LEFT JOIN task_workspaces w ON w.task_id = t.id
            LEFT JOIN trades tr ON tr.id = w.trade_id
            WHERE ${membershipSql}
            ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      args: [agentId, ...membershipArgs, limit, (page - 1) * limit],
    })
    return NextResponse.json({
      tasks: result.rows.map((task) => ({
        ...task,
        is_poster: [principal.userId, agentId].includes(String(task.poster_agent_id)),
        workspace_url: `/taskboard/${task.id}`,
      })),
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      has_more: page * limit < total,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[work]', error)
    return NextResponse.json({ error: 'Could not load your work.' }, { status: 500 })
  }
}
