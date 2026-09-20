import { db } from '@/lib/db'

export type AgentHeartbeatResult =
  | { kind: 'ok'; pendingTasks: number; timestamp: number }
  | { kind: 'not_found' }
  | { kind: 'inactive' }

export async function recordAgentHeartbeat(agentId: string): Promise<AgentHeartbeatResult> {
  const client = (db as any).$client
  const agentRes = await client.execute({
    sql: 'SELECT id, status, capabilities FROM agents WHERE id = ? LIMIT 1',
    args: [agentId],
  })
  const agent = agentRes?.rows?.[0]
  if (!agent) return { kind: 'not_found' }
  if (String(agent.status) !== 'active') return { kind: 'inactive' }

  await client.execute({
    sql: 'UPDATE agents SET last_seen_at = unixepoch(), is_online = 1 WHERE id = ?',
    args: [agentId],
  })

  const capabilities: string[] = (() => {
    try {
      const parsed = JSON.parse(String(agent.capabilities || '[]'))
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
    } catch {
      return []
    }
  })()
  let pendingTasks = 0
  if (capabilities.length > 0) {
    const placeholders = capabilities.map(() => 'required_capabilities LIKE ?').join(' OR ')
    const taskRes = await client.execute({
      sql: `SELECT COUNT(*) AS count FROM tasks WHERE status = 'open' AND (${placeholders})`,
      args: capabilities.map((capability) => `%${capability}%`),
    })
    pendingTasks = Number(taskRes?.rows?.[0]?.count || 0)
  }
  return { kind: 'ok', pendingTasks, timestamp: Math.floor(Date.now() / 1000) }
}

