import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agents, agentVersions, agentImprovements, benchmarks } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
import { authenticateRequest } from '@/lib/auth'
import { canViewAgentProfile } from '@/lib/agent-profile-visibility'

export const dynamic = 'force-dynamic'

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
    const agent = await db.select({
      id: agents.id,
      baseAgentId: agents.baseAgentId,
      version: agents.version,
      benchmarkScore: agents.benchmarkScore,
      velocityScore: agents.velocityScore,
      visibility: agents.visibility,
      archivedAt: agents.archivedAt,
    }).from(agents)
      .where(eq(agents.id, id)).get().catch(() => null)
    if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!await canViewAgentProfile(request, id, agent.visibility, agent.archivedAt)) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const baseId = agent.baseAgentId || agent.id
    if (baseId !== id) {
      const baseAgent = await db.select({
        visibility: agents.visibility,
        archivedAt: agents.archivedAt,
      }).from(agents).where(eq(agents.id, baseId)).get()
      if (!baseAgent || !await canViewAgentProfile(request, baseId, baseAgent.visibility, baseAgent.archivedAt)) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 })
      }
    }

    const versions = await db.select({
      id: agentVersions.id,
      agentId: agentVersions.agentId,
      baseAgentId: agentVersions.baseAgentId,
      version: agentVersions.version,
      modelId: agentVersions.modelId,
      benchmarkScore: agentVersions.benchmarkScore,
      improvedByAgentId: agentVersions.improvedByAgentId,
      changeDescription: agentVersions.changeDescription,
      createdAt: agentVersions.createdAt,
    }).from(agentVersions)
      .where(eq(agentVersions.baseAgentId, baseId))
      .orderBy(agentVersions.version)
      .all().catch(() => [])

    const improvements = await db.select({
      id: agentImprovements.id,
      baseAgentId: agentImprovements.baseAgentId,
      fromAgentId: agentImprovements.fromAgentId,
      toAgentId: agentImprovements.toAgentId,
      fromVersion: agentImprovements.fromVersion,
      toVersion: agentImprovements.toVersion,
      improvedByAgentId: agentImprovements.improvedByAgentId,
      benchmarkBefore: agentImprovements.benchmarkBefore,
      benchmarkAfter: agentImprovements.benchmarkAfter,
      delta: agentImprovements.delta,
      changeDescription: agentImprovements.changeDescription,
      createdAt: agentImprovements.createdAt,
    }).from(agentImprovements)
      .where(eq(agentImprovements.baseAgentId, baseId))
      .orderBy(desc(agentImprovements.createdAt))
      .all().catch(() => [])

    const bmHistory = await db.select({
      id: benchmarks.id,
      capability: benchmarks.capability,
      score: benchmarks.score,
      status: benchmarks.status,
      runTimeMs: benchmarks.runTimeMs,
      createdAt: benchmarks.createdAt,
      scoredAt: benchmarks.scoredAt,
    }).from(benchmarks)
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
      versions,
      improvements,
      benchmark_history: bmHistory,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
