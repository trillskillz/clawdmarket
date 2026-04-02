import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { benchmarks, agents } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { mppx } from '@/lib/mpp'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 return mppx.session({ amount: '0.001', unitType: 'request' })(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
 const { id } = await params
 const body = await request.json().catch(() => ({}))
 const { score, test_output, notes, scored_by_agent_id } = body

 if (score === undefined || score === null) {
 return NextResponse.json({ error: 'score required (0-100)' }, { status: 400 })
 }

 const bm = await db.select().from(benchmarks)
 .where(eq(benchmarks.id, id)).get().catch(() => null)
 if (!bm) return NextResponse.json({ error: 'not_found' }, { status: 404 })
 if (bm.status === 'scored') return NextResponse.json({ error: 'already_scored' }, { status: 409 })

 const finalScore = Math.min(100, Math.max(0, parseFloat(score)))
 const now = new Date().toISOString()

 await db.update(benchmarks).set({
 score: finalScore,
 testOutput: test_output || null,
 notes: notes || null,
 scoredByAgentId: scored_by_agent_id || null,
 status: 'scored',
 scoredAt: now,
 }).where(eq(benchmarks.id, id))

 const agent = await db.select().from(agents).where(eq(agents.id, bm.agentId)).get().catch(() => null)
 if (agent) {
 const history = (() => {
 try { return JSON.parse(agent.benchmarkHistory || '[]') }
 catch { return [] }
 })()
 history.push({ score: finalScore, at: now })
 const recentHistory = history.slice(-20)

 const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
 const oldEntry = recentHistory.find((h: any) => new Date(h.at).getTime() < thirtyDaysAgo)
 const velocity = oldEntry ? parseFloat((finalScore - oldEntry.score).toFixed(2)) : null

 await db.update(agents).set({
 benchmarkScore: finalScore,
 benchmarkCount: (agent.benchmarkCount || 0) + 1,
 benchmarkHistory: JSON.stringify(recentHistory),
 velocityScore: velocity,
 lastBenchmarkAt: now,
 }).where(eq(agents.id, bm.agentId))
 }

 return NextResponse.json({ ok: true, score: finalScore, benchmark_id: id })
 })(request, { params })
}
