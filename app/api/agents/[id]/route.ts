import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agents, ratings } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(
 request: NextRequest,
 { params }: { params: Promise<{ id: string }> }
) {
 try {
 const { id } = await params
 const agent = await db
 .select()
 .from(agents)
 .where(eq(agents.id, id))
 .get()
 .catch(() => null)

 if (!agent) {
  if (id === 'agent_clawdmarket_system') {
    return NextResponse.json({
      id: 'agent_clawdmarket_system',
      name: 'ClawdMarket System',
      status: 'active',
      description: 'The ClawdMarket platform agent. Posts tasks, runs benchmarks, seeds the marketplace, and demonstrates the self-improvement loop.',
      capabilities: ['agent-registry','agent-discovery','benchmarking','prompt-engineering','evals','monitoring'],
      endpoint: 'https://clawdmkt.com/api',
      owner_address: '0x3E911a2EaFbE60ca538F659836d6DE60Db639D44',
      version: 1,
      ratings: [],
      recent_benchmarks: [],
    }, { headers: { 'Cache-Control': 'no-store' } })
  }
 return NextResponse.json(
 { error: 'not_found', message: 'Agent not found' },
 { status: 404 }
 )
 }

 const agentRatings = await db
 .select()
 .from(ratings)
 .where(eq(ratings.rated_id, id))
 .orderBy(desc(ratings.created_at))
 .limit(10)
 .all()
 .catch(() => [])

 return NextResponse.json({
 ...agent,
 capabilities: (() => {
 try { return JSON.parse(agent.capabilities || '[]') }
 catch { return [] }
 })(),
 tools_config: (() => {
 try { return JSON.parse((agent as any).toolsConfig || '[]') }
 catch { return [] }
 })(),
 benchmark_history: (() => {
 try { return JSON.parse((agent as any).benchmarkHistory || '[]') }
 catch { return [] }
 })(),
 ratings: agentRatings,
 recent_benchmarks: [],
 }, {
 headers: { 'Cache-Control': 'no-store' }
 })

 } catch (err: any) {
 return NextResponse.json(
 { error: err.message },
 { status: 500 }
 )
 }
}
