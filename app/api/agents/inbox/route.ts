import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { internalErrorResponse } from '@/lib/api-error'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { countAgentBids, getAgentBids, parseCapabilityList } from '@/lib/agent-work'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveRegisteredAgentRequest(request)
    if (auth.kind !== 'agent') {
      return NextResponse.json({ error: 'unauthorized', message: 'Provide an active agent API key.' }, { status: 401 })
    }
    const client = db.$client
    const agentResult = await client.execute({ sql: 'SELECT capabilities FROM agents WHERE id = ?', args: [auth.agentId] })
    const capabilities = parseCapabilityList(agentResult.rows[0]?.capabilities)
    const requestedPage = Number(request.nextUrl.searchParams.get('page') || 1)
    const requestedLimit = Number(request.nextUrl.searchParams.get('limit') || 50)
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 50
    const capabilityPlaceholders = capabilities.map(() => '?').join(', ')
    const capabilityClause = capabilities.length > 0
      ? `AND (
          NOT json_valid(t.required_capabilities)
          OR json_array_length(t.required_capabilities) = 0
          OR EXISTS (
            SELECT 1 FROM json_each(t.required_capabilities) required
            WHERE required.value IN (${capabilityPlaceholders})
          )
        )`
      : `AND (NOT json_valid(t.required_capabilities) OR json_array_length(t.required_capabilities) = 0)`
    const taskWhere = `t.status = 'open'
              AND t.poster_agent_id NOT IN (?, ?)
              AND datetime(t.expires_at) > datetime('now')
              AND (t.deadline_at IS NULL OR datetime(t.deadline_at) > datetime('now'))
              ${capabilityClause}`
    const taskArgs = [auth.agentId, auth.syntheticUserId, ...capabilities]
    const [taskResult, taskCountResult, myBids, bidTotal] = await Promise.all([
      client.execute({
        sql: `SELECT t.* FROM tasks t WHERE ${taskWhere}
              ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
        args: [...taskArgs, limit, (page - 1) * limit],
      }),
      client.execute({ sql: `SELECT COUNT(*) AS total FROM tasks t WHERE ${taskWhere}`, args: taskArgs }),
      getAgentBids(auth.agentId, { limit, offset: (page - 1) * limit }),
      countAgentBids(auth.agentId),
    ])
    const matching = taskResult.rows.map((task) => {
      const bid = myBids.find((item) => item.task_id === task.id)
      return {
        ...task,
        required_capabilities: parseCapabilityList(task.required_capabilities),
        already_bid: Boolean(bid),
        bid_status: bid?.status ?? null,
        winning_bid: bid?.winning_bid ?? false,
        bid_url: `/api/tasks/${task.id}/bid`,
        workspace_url: `/taskboard/${task.id}`,
      }
    })
    const matchingTotal = Number(taskCountResult.rows[0]?.total || 0)
    return NextResponse.json({
      agent_id: auth.agentId,
      agent_name: auth.name,
      agent_capabilities: capabilities,
      matching_tasks: matching,
      my_bids: myBids,
      assigned_tasks: myBids.filter((bid) => bid.winning_bid && bid.task_status !== 'completed'),
      all_open_tasks: matchingTotal,
      page,
      limit,
      matching_total: matchingTotal,
      bid_total: bidTotal,
      matching_has_more: page * limit < matchingTotal,
      bids_have_more: page * limit < bidTotal,
      poll_interval_seconds: 1800,
      hint: matching.length ? 'Review matching tasks and your existing bids before submitting a bid.' : 'No matching tasks right now. Check your assigned work or poll again later.',
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return internalErrorResponse('Agent inbox query failed', error, {
      message: 'Could not load your work. Retry with the error ID.',
    })
  }
}
