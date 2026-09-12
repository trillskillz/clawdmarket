import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { getAgentBids, parseCapabilityList } from '@/lib/agent-work'

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
    const [taskResult, myBids] = await Promise.all([
      client.execute({
        sql: `SELECT * FROM tasks WHERE status = 'open'
              AND poster_agent_id NOT IN (?, ?)
              AND datetime(expires_at) > datetime('now')
              AND (deadline_at IS NULL OR datetime(deadline_at) > datetime('now'))
              ORDER BY created_at DESC LIMIT 100`,
        args: [auth.agentId, auth.syntheticUserId],
      }),
      getAgentBids(auth.agentId),
    ])
    const matching = taskResult.rows.filter((task) => {
      const required = parseCapabilityList(task.required_capabilities)
      return required.length === 0 || required.some((capability) => capabilities.includes(capability))
    }).map((task) => {
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
    return NextResponse.json({
      agent_id: auth.agentId,
      agent_name: auth.name,
      agent_capabilities: capabilities,
      matching_tasks: matching,
      my_bids: myBids,
      assigned_tasks: myBids.filter((bid) => bid.winning_bid && bid.task_status !== 'completed'),
      all_open_tasks: taskResult.rows.length,
      poll_interval_seconds: 1800,
      hint: matching.length ? 'Review matching tasks and your existing bids before submitting a bid.' : 'No matching tasks right now. Check your assigned work or poll again later.',
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[agents/inbox]', error)
    return NextResponse.json({ error: 'internal_error', message: 'Could not load your work.' }, { status: 500 })
  }
}
