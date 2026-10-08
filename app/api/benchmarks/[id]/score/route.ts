import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { benchmarks } from '@/lib/schema'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { internalErrorResponse } from '@/lib/api-error'
import { peerBenchmarkParticipantsEligible, PEER_BENCHMARK_EVIDENCE } from '@/lib/peer-benchmarks'
import { withKeyedWriteLock } from '@/lib/service-reservation-lock'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
const scoreSchema = z.object({ score: z.number().finite().min(0).max(100), test_output: z.string().max(100_000).optional(), notes: z.string().max(5_000).optional() }).strict()

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await resolveRegisteredAgentRequest(request)
  if (auth.kind !== 'agent') return NextResponse.json({ error: 'unauthorized' }, { status: auth.kind === 'forbidden' ? 403 : 401, headers })
  const rl = await rateLimit(`benchmark-score:${auth.agentId}`, { interval: 60_000, maxRequests: 30, failClosed: true })
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { ...headers, ...getRateLimitHeaders(rl) } })
  const parsed = scoreSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', details: parsed.error.issues }, { status: 400, headers })
  const input = parsed.data
  try {
    const result = await withKeyedWriteLock(`peer-benchmark:${id}`, () => db.transaction(async (tx) => {
      const benchmark = (await tx.select().from(benchmarks).where(eq(benchmarks.id, id)).limit(1))[0]
      if (!benchmark || benchmark.evaluatorAgentId !== auth.agentId) return { error: 'not_found', status: 404 } as const
      if (!await peerBenchmarkParticipantsEligible(tx, benchmark.agentId, auth.agentId)) return { error: 'participants_ineligible', status: 403 } as const
      if (benchmark.status === 'scored') {
        if (benchmark.scoredByAgentId === auth.agentId && benchmark.score === input.score && benchmark.testOutput === (input.test_output ?? null) && benchmark.notes === (input.notes ?? null)) return { benchmark, reused: true }
        return { error: 'already_scored', status: 409 } as const
      }
      if (benchmark.status !== 'pending') return { error: 'invalid_state', status: 409 } as const
      const [scored] = await tx.update(benchmarks).set({ score: input.score, testOutput: input.test_output ?? null,
        notes: input.notes ?? null, scoredByAgentId: auth.agentId, status: 'scored', scoredAt: new Date().toISOString() })
        .where(and(eq(benchmarks.id, id), eq(benchmarks.status, 'pending'), eq(benchmarks.evaluatorAgentId, auth.agentId))).returning()
      if (!scored) return { error: 'already_scored', status: 409 } as const
      // Peer scores remain assertions. Never update quality/trust aggregates.
      return { benchmark: scored, reused: false }
    }))
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status, headers })
    return NextResponse.json({ ok: true, score: result.benchmark.score, benchmark_id: id,
      scored_by_agent_id: auth.agentId, reused: result.reused, evidence: PEER_BENCHMARK_EVIDENCE }, { headers })
  } catch (error) { return internalErrorResponse('Peer benchmark scoring failed', error) }
}
