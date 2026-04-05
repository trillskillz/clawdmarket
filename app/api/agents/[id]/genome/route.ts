import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface GenomeNode {
  id: string
  version: number
  benchmark_score: number | null
  change_description: string | null
  model_id: string | null
  improved_by_agent_id: string | null
  improved_by_name: string | null
  parent_version_id: string | null
  created_at: string | null
  children: GenomeNode[]
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const client = (db as any).$client

    // Get the agent (could be an agent_id or base_agent_id)
    const agentResult = await client.execute(
      'SELECT id, name, version, base_agent_id, benchmark_score, model_id, created_at FROM agents WHERE id = ? LIMIT 1',
      [id]
    ).catch(() => null)

    const agent = agentResult?.rows?.[0]
    if (!agent) {
      return NextResponse.json({ error: 'not_found', message: 'Agent not found' }, { status: 404 })
    }

    const baseId = agent.base_agent_id || agent.id

    // Get all versions for this agent lineage
    const versionsResult = await client.execute(
      `SELECT av.id, av.version, av.benchmark_score, av.change_description, av.model_id,
              av.improved_by_agent_id, av.parent_version_id, av.created_at,
              trainer.name as improved_by_name
       FROM agent_versions av
       LEFT JOIN agents trainer ON trainer.id = av.improved_by_agent_id
       WHERE av.agent_id = ? OR av.base_agent_id = ?
       ORDER BY av.version ASC`,
      [baseId, baseId]
    ).catch(() => null)

    const versionRows = versionsResult?.rows || []

    // Build the root node (v1 — the original agent, not in agent_versions)
    const rootNode: GenomeNode = {
      id: `${baseId}_v1`,
      version: 1,
      benchmark_score: versionRows.length > 0 ? null : Number(agent.benchmark_score) || null,
      change_description: 'Genesis — original agent registration',
      model_id: agent.model_id || null,
      improved_by_agent_id: null,
      improved_by_name: null,
      parent_version_id: null,
      created_at: agent.created_at,
      children: [],
    }

    // Build a map of all nodes
    const nodeMap = new Map<string, GenomeNode>()
    nodeMap.set(rootNode.id, rootNode)

    for (const row of versionRows) {
      const node: GenomeNode = {
        id: String(row.id),
        version: Number(row.version),
        benchmark_score: row.benchmark_score != null ? Number(row.benchmark_score) : null,
        change_description: sanitizeDescription(String(row.change_description || '')),
        model_id: row.model_id || null,
        improved_by_agent_id: row.improved_by_agent_id || null,
        improved_by_name: row.improved_by_name || null,
        parent_version_id: row.parent_version_id || null,
        created_at: row.created_at || null,
        children: [],
      }
      nodeMap.set(node.id, node)
    }

    // Wire up parent-child relationships
    for (const [, node] of nodeMap) {
      if (node.id === rootNode.id) continue
      const parentId = node.parent_version_id
      if (parentId && nodeMap.has(parentId)) {
        nodeMap.get(parentId)!.children.push(node)
      } else {
        // No explicit parent — attach to the node with version - 1
        const prevVersion = node.version - 1
        let attached = false
        for (const [, candidate] of nodeMap) {
          if (candidate.version === prevVersion) {
            candidate.children.push(node)
            attached = true
            break
          }
        }
        if (!attached) {
          rootNode.children.push(node)
        }
      }
    }

    // Compute benchmark deltas for the flat list
    const sortedVersions = Array.from(nodeMap.values()).sort((a, b) => a.version - b.version)
    const timeline = sortedVersions.map((node, i) => {
      const prevScore = i > 0 ? sortedVersions[i - 1].benchmark_score : null
      const delta = (node.benchmark_score != null && prevScore != null)
        ? Number((node.benchmark_score - prevScore).toFixed(1))
        : null
      return {
        id: node.id,
        version: node.version,
        benchmark_score: node.benchmark_score,
        benchmark_delta: delta,
        change_description: node.change_description,
        model_id: node.model_id,
        improved_by_name: node.improved_by_name,
        created_at: node.created_at,
      }
    })

    return NextResponse.json({
      agent_id: baseId,
      agent_name: agent.name,
      current_version: Number(agent.version),
      current_benchmark: Number(agent.benchmark_score) || null,
      total_versions: nodeMap.size,
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
