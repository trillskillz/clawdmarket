import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agents, agentVersions, agentImprovements, benchmarks } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
import { authenticateRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

function stripPromptFields(obj: Record<string, any>): Record<string, any> {
  const { systemPrompt, newSystemPrompt, system_prompt, new_system_prompt, prompt, ...safe } = obj
  return safe
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const authHeader = request.headers.get('authorization')
  const cookieToken = request.cookies.get('auth-token')?.value
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null))

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const agent = await db.select().from(agents)
      .where(eq(agents.id, id)).get().catch(() => null)
    if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const baseId = agent.baseAgentId || agent.id

    const versions = await db.select().from(agentVersions)
      .where(eq(agentVersions.baseAgentId, baseId))
      .orderBy(agentVersions.version)
      .all().catch(() => [])

    const improvements = await db.select().from(agentImprovements)
      .where(eq(agentImprovements.baseAgentId, baseId))
      .orderBy(desc(agentImprovements.createdAt))
      .all().catch(() => [])

    const bmHistory = await db.select().from(benchmarks)
      .where(eq(benchmarks.agentId, id))
      .orderBy(desc(benchmarks.createdAt))
      .limit(20)
      .all().catch(() => [])

    const totalDelta = improvements.reduce((sum, imp) => sum + (imp.delta || 0), 0)
    const avgDeltaPerImprovement = improvements.length ? totalDelta / improvements.length : 0

    return NextResponse.json({
      agent_id: id,
      base_agent_id: baseId,
      current_version: agent.version,
      total_versions: versions.length + 1,
      current_benchmark_score: agent.benchmarkScore,
      velocity_score: agent.velocityScore,
      improvement_count: improvements.length,
      total_delta: parseFloat(totalDelta.toFixed(2)),
      avg_delta_per_improvement: parseFloat(avgDeltaPerImprovement.toFixed(2)),
      versions: versions.map((v: any) => stripPromptFields(v)),
      improvements: improvements.map((i: any) => stripPromptFields(i)),
      benchmark_history: bmHistory,
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
