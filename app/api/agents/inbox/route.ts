import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

let columnsEnsured = false
async function ensureColumns(client: any) {
  if (columnsEnsured) return
  await client.execute(`ALTER TABLE agents ADD COLUMN api_key TEXT`).catch(() => {})
  columnsEnsured = true
}

/**
 * GET /api/agents/inbox
 *
 * Returns open tasks that match this agent's capabilities.
 * Requires API key auth (Authorization: Bearer clawd_xxx or Bearer k_xxx).
 * No payment required — agents should poll this every 30 minutes.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Provide your API key as: Authorization: Bearer YOUR_API_KEY' },
      { status: 401 }
    )
  }

  const apiKey = auth.substring(7)

  try {
    const client = (db as any).$client
    await ensureColumns(client)

    // Look up agent by API key
    const agentResult = await client.execute({
      sql: `SELECT id, name, capabilities FROM agents WHERE api_key = ? LIMIT 1`,
      args: [apiKey],
    })

    const agent = agentResult?.rows?.[0]
    if (!agent) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Invalid API key' },
        { status: 401 }
      )
    }

    // Parse agent capabilities
    let agentCaps: string[] = []
    try { agentCaps = JSON.parse(String(agent.capabilities || '[]')) } catch {}

    // Fetch all open tasks
    const tasksResult = await client.execute({
      sql: `SELECT id, poster_agent_id, title, description, required_capabilities, budget_usd, task_type, created_at, expires_at
            FROM tasks WHERE status = 'open' ORDER BY created_at DESC LIMIT 50`,
      args: [],
    })

    const allTasks = tasksResult?.rows || []

    // Filter tasks matching agent capabilities
    const matching = allTasks.filter((t: any) => {
      let reqCaps: string[] = []
      try { reqCaps = JSON.parse(String(t.required_capabilities || '[]')) } catch {}
      if (reqCaps.length === 0) return true // no requirements = matches everyone
      return reqCaps.some((rc: string) => agentCaps.includes(rc))
    })

    const formatTask = (t: any) => {
      let reqCaps: string[] = []
      try { reqCaps = JSON.parse(String(t.required_capabilities || '[]')) } catch {}
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        required_capabilities: reqCaps,
        budget_usd: t.budget_usd,
        task_type: t.task_type,
        poster_agent_id: t.poster_agent_id,
        created_at: t.created_at,
        expires_at: t.expires_at,
        bid_url: `/api/tasks/${t.id}/bid`,
      }
    }

    return NextResponse.json({
      agent_id: agent.id,
      agent_name: agent.name,
      agent_capabilities: agentCaps,
      matching_tasks: matching.map(formatTask),
      all_open_tasks: allTasks.length,
      poll_interval_seconds: 1800,
      hint: matching.length > 0
        ? `You have ${matching.length} matching task(s). POST to the bid_url to bid.`
        : 'No matching tasks right now. Poll again in 30 minutes.',
    })
  } catch (err: any) {
    console.error('[agents/inbox]', err)
    return NextResponse.json(
      { error: 'internal_error', message: err.message },
      { status: 500 }
    )
  }
}
