import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

let migrationChecked = false

async function ensureHeartbeatColumns() {
  if (migrationChecked) return
  const client = (db as any).$client
  const info = await client.execute({ sql: `PRAGMA table_info(agents)`, args: [] })
  const cols = new Set((info?.rows || []).map((r: any) => String(r.name || r[1] || '')))
  if (!cols.has('last_seen_at')) {
    await client.execute({ sql: `ALTER TABLE agents ADD COLUMN last_seen_at INTEGER`, args: [] })
  }
  if (!cols.has('is_online')) {
    await client.execute({ sql: `ALTER TABLE agents ADD COLUMN is_online INTEGER DEFAULT 0`, args: [] })
  }
  migrationChecked = true
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const client = (db as any).$client

    await ensureHeartbeatColumns()

    // Verify agent exists
    const agentRes = await client.execute({ sql: `SELECT id FROM agents WHERE id = ?`, args: [id] })
    if (!agentRes?.rows?.length) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
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
