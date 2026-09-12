import { db } from '@/lib/db'

export function parseCapabilityList(value: unknown): string[] {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

export async function getAgentBids(agentId: string) {
  const result = await db.$client.execute({
    sql: `SELECT b.*, t.title AS task_title, t.status AS task_status,
                 t.winning_bid_id, t.deadline_at, t.assigned_agent_id
          FROM bids b JOIN tasks t ON t.id = b.task_id
          WHERE b.bidder_agent_id = ? ORDER BY b.created_at DESC LIMIT 100`,
    args: [agentId],
  })
  return result.rows.map((bid) => ({
    ...bid,
    task_id: String(bid.task_id),
    status: String(bid.status),
    task_status: String(bid.task_status),
    winning_bid: bid.winning_bid_id === bid.id && bid.assigned_agent_id === agentId,
    workspace_url: `/taskboard/${bid.task_id}`,
  }))
}
