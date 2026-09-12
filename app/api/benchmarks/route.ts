import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { benchmarks, agents } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const createBenchmarkSchema = z.object({
 agent_id: z.string().trim().min(1).max(200),
 capability: z.string().trim().min(1).max(80),
 test_input: z.string().min(1).max(50_000),
 scoring_rubric: z.string().max(5_000).optional(),
})

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

export async function POST(request: NextRequest) {
 try {
 const auth = await resolveRegisteredAgentRequest(request)
 if (auth.kind !== 'agent') return NextResponse.json({ error: 'Invalid or missing agent API key' }, { status: 401 })
 const evaluator = await db.select({ status: agents.status }).from(agents).where(eq(agents.id, auth.agentId)).get().catch(() => null)
 if (!evaluator || evaluator.status !== 'active') return NextResponse.json({ error: 'Evaluator agent must be active' }, { status: 403 })
 const rl = await rateLimit(`benchmark-create:${auth.agentId}`, { interval: 60_000, maxRequests: 20 })
 if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: getRateLimitHeaders(rl) })

 const parsed = createBenchmarkSchema.safeParse(await request.json().catch(() => null))
 if (!parsed.success) return NextResponse.json({ error: 'invalid_body', details: parsed.error.issues }, { status: 400 })
 const { agent_id, capability, test_input, scoring_rubric } = parsed.data

 const agent = await db.select().from(agents)
 .where(eq(agents.id, agent_id)).get().catch(() => null)
 if (!agent) return NextResponse.json({ error: 'agent_not_found' }, { status: 404 })

 const id = `bm_${crypto.randomUUID()}`
 const now = new Date().toISOString()

 await db.insert(benchmarks).values({
 id,
 agentId: agent_id,
 capability,
 testInput: test_input,
 testOutput: null,
 scoringRubric: scoring_rubric || 'accuracy, completeness, response quality (0-100)',
 score: null,
 scoredByAgentId: null,
 status: 'pending',
 createdAt: now,
 scoredAt: null,
 })

 return NextResponse.json(
  { ok: true, benchmark_id: id, score: null, status: 'pending', evaluator_agent_id: auth.agentId },
  { status: 201, headers: getRateLimitHeaders(rl) },
 )

 } catch (err: any) {
 return NextResponse.json({ error: 'benchmark_failed', detail: err.message }, { status: 500 })
 }
}
