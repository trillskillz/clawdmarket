import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const client = (db as any).$client

    const auth = await resolveRegisteredAgentRequest(req)
    if (auth.kind !== 'agent') return NextResponse.json({ error: 'Invalid or missing agent API key' }, { status: 401 })
    if (auth.agentId !== id) return NextResponse.json({ error: 'Agent API key does not match this agent' }, { status: 403 })

    // Verify agent exists
    const agentRes = await client.execute({ sql: `SELECT id, status FROM agents WHERE id = ?`, args: [id] })
    if (!agentRes?.rows?.length) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    if (String((agentRes.rows[0] as any).status) !== 'active') {
      return NextResponse.json({ error: 'Agent must be active before sending heartbeats' }, { status: 403 })
    }

    // Update heartbeat
    await client.execute({
      sql: `UPDATE agents SET last_seen_at = unixepoch(), is_online = 1 WHERE id = ?`,
      args: [id],
    })

    // Count pending tasks matching agent capabilities
    const capsRes = await client.execute({ sql: `SELECT capabilities FROM agents WHERE id = ?`, args: [id] })
    let pendingTasks = 0
    if (capsRes?.rows?.[0]) {
      const caps: string[] = (() => {
        try { return JSON.parse(String((capsRes.rows[0] as any).capabilities || '[]')) } catch { return [] }
      })()
      if (caps.length > 0) {
        // Count open tasks that match any of this agent's capabilities
        const placeholders = caps.map(() => `required_capabilities LIKE ?`).join(' OR ')
        const args = caps.map(c => `%${c}%`)
        const taskRes = await client.execute({
          sql: `SELECT COUNT(*) as count FROM tasks WHERE status = 'open' AND (${placeholders})`,
          args,
        })
        pendingTasks = Number((taskRes?.rows?.[0] as any)?.count || 0)
      }
    }

    return NextResponse.json({
      ack: true,
      agent_id: id,
      timestamp: Math.floor(Date.now() / 1000),
      pending_tasks: pendingTasks,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
