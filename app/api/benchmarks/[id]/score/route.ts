import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { agents, benchmarks } from '@/lib/schema';
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const scoreSchema = z.object({
  score: z.coerce.number().min(0).max(100),
  test_output: z.string().max(100_000).optional(),
  notes: z.string().max(5_000).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await resolveRegisteredAgentRequest(request);
  if (auth.kind !== 'agent') return NextResponse.json({ error: 'Invalid or missing agent API key' }, { status: 401 });

  const evaluator = await db.select({ status: agents.status }).from(agents).where(eq(agents.id, auth.agentId)).get().catch(() => null);
  if (!evaluator || evaluator.status !== 'active') return NextResponse.json({ error: 'Evaluator agent must be active' }, { status: 403 });
  const rl = await rateLimit(`benchmark-score:${auth.agentId}`, { interval: 60_000, maxRequests: 30, failClosed: true });
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: getRateLimitHeaders(rl) });

  const parsed = scoreSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', details: parsed.error.issues }, { status: 400 });

  try {
    const benchmark = await db.select().from(benchmarks).where(eq(benchmarks.id, id)).get().catch(() => null);
    if (!benchmark) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (benchmark.agentId === auth.agentId) return NextResponse.json({ error: 'Agents cannot score their own benchmark' }, { status: 403 });
    if (benchmark.status === 'scored') return NextResponse.json({ error: 'already_scored' }, { status: 409 });

    const now = new Date().toISOString();
    const finalScore = parsed.data.score;
    const updated = await db.transaction(async (tx) => {
      const [scored] = await tx
        .update(benchmarks)
        .set({
          score: finalScore,
          testOutput: parsed.data.test_output || null,
          notes: parsed.data.notes || null,
          scoredByAgentId: auth.agentId,
          status: 'scored',
          scoredAt: now,
        })
        .where(and(eq(benchmarks.id, id), eq(benchmarks.status, 'pending')))
        .returning();
      if (!scored) return null;

      const agent = await tx.select().from(agents).where(eq(agents.id, benchmark.agentId)).get().catch(() => null);
      if (agent) {
        const history = (() => {
          try { return JSON.parse(agent.benchmarkHistory || '[]'); } catch { return []; }
        })();
        history.push({ score: finalScore, at: now, evaluator_agent_id: auth.agentId });
        const recentHistory = history.slice(-20);
        const oldest = recentHistory[0];
        const velocity = oldest && recentHistory.length > 1 ? Number((finalScore - Number(oldest.score || 0)).toFixed(2)) : null;
        await tx.update(agents).set({
          benchmarkScore: finalScore,
          benchmarkCount: (agent.benchmarkCount || 0) + 1,
          benchmarkHistory: JSON.stringify(recentHistory),
          velocityScore: velocity,
          lastBenchmarkAt: now,
        }).where(eq(agents.id, benchmark.agentId));
      }
      return scored;
    });

    if (!updated) return NextResponse.json({ error: 'already_scored' }, { status: 409 });
    return NextResponse.json({ ok: true, score: finalScore, benchmark_id: id, scored_by_agent_id: auth.agentId });
  } catch (error: any) {
    console.error('[benchmark-score]', error);
    return NextResponse.json({ error: 'benchmark_score_failed' }, { status: 500 });
  }
}
