import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { benchmarks, agents } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
import { mppx } from '@/lib/mpp'

export async function GET(request: NextRequest) {
 const { searchParams } = new URL(request.url)
 const agentId = searchParams.get('agent_id')
 const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)

 try {
 const results = agentId
  ? await db.select().from(benchmarks).where(eq(benchmarks.agentId, agentId)).orderBy(desc(benchmarks.createdAt)).limit(limit).all().catch(() => [])
  : await db.select().from(benchmarks).orderBy(desc(benchmarks.createdAt)).limit(limit).all().catch(() => [])
 return NextResponse.json({ benchmarks: results, total: results.length })
 } catch (err: any) {
 return NextResponse.json({ benchmarks: [], error: err.message })
 }
}

export const POST = mppx.session({ amount: '0.001', unitType: 'request' })(
 async (request: NextRequest) => {
 try {
 const body = await request.json()
 const { agent_id, capability, test_input, scoring_rubric, test_output, score, scored_by_agent_id } = body

 if (!agent_id || !capability || !test_input) {
 return NextResponse.json(
 { error: 'invalid_body', message: 'agent_id, capability, test_input required' },
 { status: 400 }
 )
 }

 const agent = await db.select().from(agents)
 .where(eq(agents.id, agent_id)).get().catch(() => null)
 if (!agent) return NextResponse.json({ error: 'agent_not_found' }, { status: 404 })

 const id = `bm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
 const now = new Date().toISOString()
 const isScored = score !== undefined && score !== null
 const finalScore = isScored ? parseFloat(score) : null

 await db.insert(benchmarks).values({
 id,
 agentId: agent_id,
 capability,
 testInput: test_input,
 testOutput: test_output || null,
 scoringRubric: scoring_rubric || 'accuracy, completeness, response quality (0-100)',
 score: finalScore,
 scoredByAgentId: scored_by_agent_id || null,
 status: isScored ? 'scored' : 'pending',
 createdAt: now,
 scoredAt: isScored ? now : null,
 })

 if (isScored) {
 const history = (() => {
 try { return JSON.parse(agent.benchmarkHistory || '[]') }
 catch { return [] }
 })()
 history.push({ score: finalScore, at: now })
 const recentHistory = history.slice(-20)
 const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
 const oldEntry = recentHistory.find((h: any) => new Date(h.at).getTime() < thirtyDaysAgo)
 const velocity = oldEntry ? parseFloat((finalScore! - oldEntry.score).toFixed(2)) : null

 await db.update(agents).set({
 benchmarkScore: finalScore,
 benchmarkCount: (agent.benchmarkCount || 0) + 1,
 benchmarkHistory: JSON.stringify(recentHistory),
 velocityScore: velocity,
 lastBenchmarkAt: now,
 }).where(eq(agents.id, agent_id))
 }

 return NextResponse.json({ ok: true, benchmark_id: id, score: finalScore, status: isScored ? 'scored' : 'pending' })

 } catch (err: any) {
 return NextResponse.json({ error: 'benchmark_failed', detail: err.message }, { status: 500 })
 }
 }
)
