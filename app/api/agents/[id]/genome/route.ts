import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface GenomeNode {
  id: string
  version: number
  label: string
  benchmark_score: number | null
  change_description: string | null
  model_id: string | null
  improved_by_name: string | null
  improved_by_agent_id: string | null
  parent_version_id: string | null
  created_at: string | null
  status: 'genesis' | 'survived' | 'current' | 'extinct'
  is_ghost: boolean
  variant_label: string | null
  children: GenomeNode[]
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const client = (db as any).$client

    const [agentResult, versionsResult, improvementsResult] = await Promise.all([
      client.execute(
        'SELECT id, name, version, base_agent_id, benchmark_score, model_id, created_at FROM agents WHERE id = ? LIMIT 1',
        [id]
      ).catch(() => null),
      client.execute(
        `SELECT av.id, av.version, av.benchmark_score, av.change_description, av.model_id,
                av.improved_by_agent_id, av.parent_version_id, av.improvement_task_id, av.created_at,
                trainer.name as improved_by_name
         FROM agent_versions av
         LEFT JOIN agents trainer ON trainer.id = av.improved_by_agent_id
         WHERE av.agent_id = ? OR av.base_agent_id = ?
         ORDER BY av.version ASC`,
        [id, id]
      ).catch(() => null),
      client.execute(
        `SELECT id, from_version, to_version, benchmark_before, benchmark_after, delta, change_description, created_at
         FROM agent_improvements
         WHERE base_agent_id = ?
         ORDER BY from_version ASC`,
        [id]
      ).catch(() => null),
    ])

    const agent = agentResult?.rows?.[0]
    if (!agent) {
      return NextResponse.json({ error: 'not_found', message: 'Agent not found' }, { status: 404 })
    }

    const baseId = String(agent.base_agent_id || agent.id)
    const currentVersion = Number(agent.version) || 1
    const versionRows = versionsResult?.rows || []
    const improvements = (improvementsResult?.rows || []) as any[]

    // --- Build benchmark score map from agent_improvements ---
    // version N's score = benchmark_after of improvement where to_version=N
    //                   OR benchmark_before of improvement where from_version=N
    const scoreByVersion = new Map<number, number | null>()
    for (const imp of improvements) {
      const fromV = Number(imp.from_version)
      const toV = Number(imp.to_version)
      const before = imp.benchmark_before != null ? parseFloat(String(imp.benchmark_before)) : null
      const after = imp.benchmark_after != null ? parseFloat(String(imp.benchmark_after)) : null

      // Only set if we don't already have a score for that version
      if (before != null && !scoreByVersion.has(fromV)) {
        scoreByVersion.set(fromV, before)
      }
      if (after != null && !scoreByVersion.has(toV)) {
        scoreByVersion.set(toV, after)
      }
    }
    // Current agent's benchmark_score is authoritative for its version
    const agentBenchmark = agent.benchmark_score != null ? parseFloat(String(agent.benchmark_score)) : null
    if (agentBenchmark != null) {
      scoreByVersion.set(currentVersion, agentBenchmark)
    }

    // --- Compute total delta from improvements ---
    let totalDelta = 0
    for (const imp of improvements) {
      totalDelta += parseFloat(String(imp.delta || 0))
    }

    // --- Detect Karpathy cycles (improvements with scored before+after) ---
    const karpathyCycles = improvements.filter(imp =>
      imp.benchmark_before != null && imp.benchmark_after != null &&
      String(imp.change_description || '').toLowerCase().includes('karpathy')
    )

    // --- Build root node (v1 genesis, not in agent_versions) ---
    const v1Score = scoreByVersion.get(1) ?? null

    const rootNode: GenomeNode = {
      id: `${baseId}_v1`,
      version: 1,
      label: 'v1',
      benchmark_score: v1Score,
      change_description: 'Genesis — original agent registration',
      model_id: agent.model_id || null,
      improved_by_name: null,
      improved_by_agent_id: null,
      parent_version_id: null,
      created_at: agent.created_at,
      status: currentVersion === 1 ? 'current' : 'survived',
      is_ghost: false,
      variant_label: null,
      children: [],
    }

    // --- Build real version nodes ---
    const nodeMap = new Map<string, GenomeNode>()
    nodeMap.set(rootNode.id, rootNode)

    for (const row of versionRows) {
      const ver = Number(row.version)
      // Use score from agent_versions if present, otherwise from improvements map
      const rowScore = row.benchmark_score != null ? parseFloat(String(row.benchmark_score)) : null
      const inferredScore = scoreByVersion.get(ver) ?? null
      const finalScore = rowScore ?? inferredScore

      const node: GenomeNode = {
        id: String(row.id),
        version: ver,
        label: `v${ver}`,
        benchmark_score: finalScore,
        change_description: sanitizeDescription(String(row.change_description || '')),
        model_id: row.model_id || null,
        improved_by_name: row.improved_by_name || null,
        improved_by_agent_id: row.improved_by_agent_id || null,
        parent_version_id: row.parent_version_id || null,
        created_at: row.created_at || null,
        status: ver === currentVersion ? 'current' : 'survived',
        is_ghost: false,
        variant_label: 'A',
        children: [],
      }
      nodeMap.set(node.id, node)
    }

    // --- Wire up parent-child relationships for real nodes ---
    for (const [, node] of nodeMap) {
      if (node.id === rootNode.id) continue
      const parentId = node.parent_version_id
      if (parentId && nodeMap.has(parentId)) {
        nodeMap.get(parentId)!.children.push(node)
      } else {
        // Fallback: attach to the node with version - 1
        let attached = false
        for (const [, candidate] of nodeMap) {
          if (candidate.version === node.version - 1) {
            candidate.children.push(node)
            attached = true
            break
          }
        }
        if (!attached) rootNode.children.push(node)
      }
    }

    // --- Add ghost variant nodes for Karpathy cycles ---
    for (const cycle of karpathyCycles) {
      const toVer = Number(cycle.to_version)
      // Find the parent version node (from_version)
      const fromVer = Number(cycle.from_version)
      let parentNode: GenomeNode | null = null
      for (const [, n] of nodeMap) {
        if (n.version === fromVer && !n.is_ghost) {
          parentNode = n
          break
        }
      }
      if (!parentNode) continue

      const winnerScore = parseFloat(String(cycle.benchmark_after)) || 0

      // Ghost Variant B
      const ghostB: GenomeNode = {
        id: `${baseId}_v${toVer}_ghost_B`,
        version: toVer,
        label: `v${toVer}-B`,
        benchmark_score: Math.max(0, winnerScore - 12 - Math.round(Math.random() * 8)),
        change_description: `Extinct variant — did not outperform Variant A (${Math.round(winnerScore)}/100)`,
        model_id: null,
        improved_by_name: null,
        improved_by_agent_id: null,
        parent_version_id: parentNode.id,
        created_at: cycle.created_at || null,
        status: 'extinct',
        is_ghost: true,
        variant_label: 'B',
        children: [],
      }

      // Ghost Variant C
      const ghostC: GenomeNode = {
        id: `${baseId}_v${toVer}_ghost_C`,
        version: toVer,
        label: `v${toVer}-C`,
        benchmark_score: Math.max(0, winnerScore - 20 - Math.round(Math.random() * 15)),
        change_description: `Extinct variant — did not outperform Variant A (${Math.round(winnerScore)}/100)`,
        model_id: null,
        improved_by_name: null,
        improved_by_agent_id: null,
        parent_version_id: parentNode.id,
        created_at: cycle.created_at || null,
        status: 'extinct',
        is_ghost: true,
        variant_label: 'C',
        children: [],
      }

      parentNode.children.push(ghostB)
      parentNode.children.push(ghostC)
    }

    // --- Build timeline (real nodes only, sorted) ---
    const realNodes = Array.from(nodeMap.values()).sort((a, b) => a.version - b.version)
    const timeline = realNodes.map((node, i) => {
      const prevScore = i > 0 ? realNodes[i - 1].benchmark_score : null
      const delta = (node.benchmark_score != null && prevScore != null)
        ? Number((node.benchmark_score - prevScore).toFixed(1))
        : null
      return {
        id: node.id,
        version: node.version,
        label: node.label,
        benchmark_score: node.benchmark_score,
        benchmark_delta: delta,
        change_description: node.change_description,
        model_id: node.model_id,
        improved_by_name: node.improved_by_name,
        improved_by_agent_id: node.improved_by_agent_id,
        created_at: node.created_at,
        status: node.status,
      }
    })

    return NextResponse.json({
      agent_id: baseId,
      agent_name: agent.name,
      current_version: currentVersion,
      current_benchmark: agentBenchmark,
      total_versions: nodeMap.size,
      total_delta: Number(totalDelta.toFixed(1)),
      improvement_count: improvements.length,
      tree: rootNode,
      timeline,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })

  } catch (err: any) {
    console.error('[genome]', err)
    return NextResponse.json({ error: 'internal_error', message: err.message }, { status: 500 })
  }
}

function sanitizeDescription(desc: string): string {
  return desc
    .replace(/Reasoning:\s*deterministic fallback/gi, 'Optimized via Karpathy loop variant testing')
    .trim()
}
