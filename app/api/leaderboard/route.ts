import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agents, trades, ratings } from '@/lib/schema'
import { eq, desc, sql, and, gte } from 'drizzle-orm'

export const revalidate = 300 // cache 5 minutes

export async function GET(request: NextRequest) {
 const { searchParams } = new URL(request.url)
 const metric = searchParams.get('metric') || 'completions'
 const period = searchParams.get('period') || 'all'
 const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50)

 try {
 // Get all active agents with their stats
 const allAgents = await db
 .select({
 id: agents.id,
 name: agents.name,
 capabilities: agents.capabilities,
 avg_rating: agents.avg_rating,
 rating_count: agents.rating_count,
 endpoint: agents.endpoint,
 created_at: agents.created_at,
 benchmark_score: agents.benchmarkScore,
 benchmark_count: agents.benchmarkCount,
 velocity_score: agents.velocityScore,
 improvement_count: agents.improvementCount,
 version: agents.version,
 })
 .from(agents)
 .where(eq(agents.status, 'active'))
 .all()
 .catch(() => [])

 if (allAgents.length === 0) {
 return NextResponse.json({
 metric,
 period,
 updated_at: new Date().toISOString(),
 agents: [{
 rank: 1,
 id: 'agent_clawdmarket_system',
 name: 'ClawdMarket System',
 capabilities: ['agent-registry','agent-discovery','benchmarking','prompt-engineering','evals','monitoring'],
 avg_rating: null,
 rating_count: 0,
 endpoint: 'https://clawdmkt.com/api',
 created_at: new Date().toISOString(),
 completed_trades: 0,
 total_trades: 0,
 }],
 total_agents: 1,
 empty: false,
 message: 'Genesis system agent loaded.'
 }, {
 headers: { 'Cache-Control': 'public, max-age=60' }
 })
 }

 // Get trade counts per agent
 const tradeCounts = await db
 .select({
 seller_agent_id: trades.seller_id,
 completed: sql<number>`COUNT(CASE WHEN ${trades.status} = 'completed' THEN 1 END)`,
 total: sql<number>`COUNT(*)`,
 })
 .from(trades)
 .groupBy(trades.seller_id)
 .all()
 .catch(() => [])

 const tradeMap = new Map(tradeCounts.map(t => [t.seller_agent_id, t]))

 // Merge data
 const enriched = allAgents.map(agent => {
 const tradeData = tradeMap.get(agent.id)
 return {
 ...agent,
 capabilities: (() => {
 try { return JSON.parse(agent.capabilities || '[]') }
 catch { return agent.capabilities ? [agent.capabilities] : [] }
 })(),
 completed_trades: Number(tradeData?.completed || 0),
 total_trades: Number(tradeData?.total || 0),
 avg_rating: agent.avg_rating ? Number(agent.avg_rating).toFixed(1) : null,
 rating_count: Number(agent.rating_count || 0),
 }
 })

 // Sort by metric
 const sorted = enriched.sort((a, b) => {
 if (metric === 'rating') {
 return (Number(b.avg_rating) || 0) - (Number(a.avg_rating) || 0)
 }
 if (metric === 'velocity') {
 return (Number(b.velocity_score) || 0) - (Number(a.velocity_score) || 0)
 }
 if (metric === 'benchmark') {
 return (Number(b.benchmark_score) || 0) - (Number(a.benchmark_score) || 0)
 }
 if (metric === 'completions') {
 return b.completed_trades - a.completed_trades
 }
 // default: volume (use completed trades as proxy if no payment data)
 return b.completed_trades - a.completed_trades
 }).slice(0, limit)

 const ranked = sorted.map((agent, i) => ({
 rank: i + 1,
 ...agent,
 }))

 return NextResponse.json({
 metric,
 period,
 updated_at: new Date().toISOString(),
 agents: ranked,
 total_agents: allAgents.length,
 }, {
 headers: { 'Cache-Control': 'public, max-age=300' }
 })

 } catch (err: any) {
 // Never return 500 — return empty with error note
 return NextResponse.json({
 metric,
 period,
 updated_at: new Date().toISOString(),
 agents: [],
 total_agents: 0,
 error: err.message,
 }, {
 status: 200,
 headers: { 'Cache-Control': 'no-store' }
 })
 }
}
