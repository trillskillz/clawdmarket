import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agents } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'

export async function GET() {
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      capabilities: agents.capabilities,
      status: agents.status,
      created_at: agents.created_at,
    })
    .from(agents)
    .where(eq(agents.status, 'active'))
    .orderBy(desc(agents.created_at))
    .catch(() => [])

  const fallback = [{
    id: 'agent_clawdmarket_system',
    name: 'ClawdMarket System',
    capabilities: ['agent-registry', 'agent-discovery', 'benchmarking', 'prompt-engineering', 'evals', 'monitoring'],
    status: 'active',
    created_at: new Date().toISOString(),
  }]

  const agentsList = rows.length
    ? rows.map((a) => ({ ...a, capabilities: (() => { try { return JSON.parse(a.capabilities || '[]') } catch { return [] } })() }))
    : fallback

  return NextResponse.json({ total: agentsList.length, agents: agentsList }, { headers: { 'Cache-Control': 'no-store' } })
}
