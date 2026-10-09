import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { benchmarks, agents } from '@/lib/schema'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { internalErrorResponse } from '@/lib/api-error'
import { normalizeCapability } from '@/lib/capabilities'
import { peerBenchmarkParticipantsEligible, publicPeerBenchmark, PEER_BENCHMARK_EVIDENCE } from '@/lib/peer-benchmarks'
import { withKeyedWriteLock } from '@/lib/service-reservation-lock'

export const dynamic = 'force-dynamic'
const privateHeaders = { 'Cache-Control': 'private, no-store' }
const defaultRubric = 'Peer-reported accuracy, completeness and response quality (0-100); not independently measured'
const createBenchmarkSchema = z.object({
  agent_id: z.string().trim().min(1).max(200), capability: z.string().trim().min(1).max(80),
  client_reference: z.string().uuid().optional(), test_input: z.string().min(1).max(50_000),
  scoring_rubric: z.string().max(5_000).optional(),
}).strict()

/** Public metadata only; raw test material requires the participant-only detail API. */
export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get('agent_id')
  const limit = Number(request.nextUrl.searchParams.get('limit') || '20')
  if (!Number.isInteger(limit) || limit < 1) return NextResponse.json({ error: 'invalid_query' }, { status: 400, headers: privateHeaders })
  try {
    const rows = await db.select({ benchmark: benchmarks }).from(benchmarks).innerJoin(agents, eq(benchmarks.agentId, agents.id))
      .where(and(eq(agents.visibility, 'public'), eq(agents.status, 'active'), sql`${agents.archivedAt} IS NULL`, agentId ? eq(benchmarks.agentId, agentId) : undefined))
      .orderBy(desc(benchmarks.createdAt), desc(benchmarks.id)).limit(Math.min(limit, 100))
    return NextResponse.json({ benchmarks: rows.map(({ benchmark }) => publicPeerBenchmark(benchmark)), total: rows.length, evidence: PEER_BENCHMARK_EVIDENCE }, { headers: privateHeaders })
  } catch (error) { return internalErrorResponse('Peer benchmark directory failed', error) }
}

export async function POST(request: NextRequest) {
  const auth = await resolveRegisteredAgentRequest(request)
  if (auth.kind !== 'agent') return NextResponse.json({ error: 'unauthorized' }, { status: auth.kind === 'forbidden' ? 403 : 401, headers: privateHeaders })
  const rl = await rateLimit(`benchmark-create:${auth.agentId}`, { interval: 60_000, maxRequests: 20, failClosed: true })
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { ...privateHeaders, ...getRateLimitHeaders(rl) } })
  const parsed = createBenchmarkSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', details: parsed.error.issues }, { status: 400, headers: privateHeaders })
  const input = parsed.data
  const capability = normalizeCapability(input.capability)
  if (!capability) return NextResponse.json({ error: 'unknown_capability' }, { status: 400, headers: privateHeaders })
  try {
    const reference = input.client_reference || crypto.randomUUID()
    const result = await withKeyedWriteLock(`peer-benchmark-create:${auth.agentId}:${reference}`, () => db.transaction(async (tx) => {
      const existingRequest = (await tx.select().from(benchmarks).where(and(eq(benchmarks.evaluatorAgentId, auth.agentId), eq(benchmarks.clientReference, reference))).limit(1))[0]
      if (existingRequest) {
        if (existingRequest.agentId !== input.agent_id || existingRequest.capability !== capability || existingRequest.testInput !== input.test_input || existingRequest.scoringRubric !== (input.scoring_rubric ?? defaultRubric)) return { error: 'reference_conflict', status: 409 } as const
        return { benchmark: existingRequest, reused: true }
      }
      const target = (await tx.select().from(agents).where(eq(agents.id, input.agent_id)).limit(1))[0]
      if (!target || target.visibility !== 'public' || target.archivedAt) return { error: 'agent_not_found', status: 404 } as const
      if (!await peerBenchmarkParticipantsEligible(tx, target.id, auth.agentId)) return { error: 'participants_ineligible', status: 403 } as const
      const [created] = await tx.insert(benchmarks).values({ id: `bm_${crypto.randomUUID()}`, agentId: target.id,
        evaluatorAgentId: auth.agentId, clientReference: reference, capability, testInput: input.test_input,
        scoringRubric: input.scoring_rubric ?? defaultRubric, status: 'pending', createdAt: new Date().toISOString() })
        .onConflictDoNothing().returning()
      const existing = created || (await tx.select().from(benchmarks).where(and(eq(benchmarks.evaluatorAgentId, auth.agentId), eq(benchmarks.clientReference, reference))).limit(1))[0]
      if (!existing) throw new Error('BENCHMARK_REFERENCE_INVARIANT')
      if (existing.agentId !== target.id || existing.capability !== capability || existing.testInput !== input.test_input || existing.scoringRubric !== (input.scoring_rubric ?? defaultRubric)) return { error: 'reference_conflict', status: 409 } as const
      return { benchmark: existing, reused: !created }
    }))
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status, headers: privateHeaders })
    return NextResponse.json({ ok: true, benchmark_id: result.benchmark.id, client_reference: reference,
      score: result.benchmark.score, status: result.benchmark.status, evaluator_agent_id: auth.agentId,
      reused: result.reused, evidence: PEER_BENCHMARK_EVIDENCE }, { status: result.reused ? 200 : 201, headers: privateHeaders })
  } catch (error) { return internalErrorResponse('Peer benchmark creation failed', error) }
}
