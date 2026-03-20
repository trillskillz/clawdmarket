import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agents, agentVersions, agentImprovements, benchmarks } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'

export async function GET(
 _request: NextRequest,
 { params }: { params: Promise<{ id: string }> }
) {
 const { id } = await params
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
 versions,
 improvements,
 benchmark_history: bmHistory,
 })
 } catch (err: any) {
 return NextResponse.json({ error: err.message }, { status: 500 })
 }
}
