'use client'

import Link from 'next/link'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'

// --- Types ---
interface GenomeNode {
  id: string
  version: number
  benchmark_score: number | null
  change_description: string | null
  model_id: string | null
  improved_by_name: string | null
  parent_version_id: string | null
  created_at: string | null
  children: GenomeNode[]
}

interface TimelineEntry {
  id: string
  version: number
  benchmark_score: number | null
  benchmark_delta: number | null
  change_description: string | null
  model_id: string | null
  improved_by_name: string | null
  created_at: string | null
}

interface GenomeData {
  agent_id: string
  agent_name: string
  current_version: number
  current_benchmark: number | null
  total_versions: number
  tree: GenomeNode
  timeline: TimelineEntry[]
}

// --- Helpers ---
function timeAgo(ts: string | number | null): string {
  if (!ts) return '—'
  const date = typeof ts === 'number'
    ? new Date(ts > 1e12 ? ts : ts * 1000)
    : new Date(ts)
  if (isNaN(date.getTime()) || date.getFullYear() < 2020) return '—'
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function scoreColor(score: number | null): string {
  if (score == null) return '#484f58'
  if (score >= 90) return '#28c840'
  if (score >= 70) return '#f59e0b'
  if (score >= 50) return '#ff9500'
  return '#ff4d4d'
}

function deltaLabel(delta: number | null): string {
  if (delta == null) return ''
  if (delta > 0) return `+${delta}`
  return `${delta}`
}

function deltaColor(delta: number | null): string {
  if (delta == null) return '#484f58'
  if (delta > 0) return '#28c840'
  if (delta < 0) return '#ff4d4d'
  return '#484f58'
}

// --- Tree Layout ---
// Assign x,y positions to each node for SVG rendering
interface LayoutNode {
  node: GenomeNode
  x: number
  y: number
  children: LayoutNode[]
}

const NODE_W = 180
const NODE_H = 80
const H_GAP = 40
const V_GAP = 100

function layoutTree(root: GenomeNode): { layout: LayoutNode; width: number; height: number } {
  let nextX = 0

  function assign(node: GenomeNode, depth: number): LayoutNode {
    const childLayouts = node.children.map(c => assign(c, depth + 1))
    const y = depth * (NODE_H + V_GAP) + 40

    let x: number
    if (childLayouts.length === 0) {
      x = nextX
      nextX += NODE_W + H_GAP
    } else if (childLayouts.length === 1) {
      x = childLayouts[0].x
    } else {
      x = (childLayouts[0].x + childLayouts[childLayouts.length - 1].x) / 2
    }

    return { node, x, y, children: childLayouts }
  }

  const layout = assign(root, 0)
  return {
    layout,
    width: nextX + NODE_W + 40,
    height: (getMaxDepth(root) + 1) * (NODE_H + V_GAP) + 80,
  }
}

function getMaxDepth(node: GenomeNode, depth = 0): number {
  if (node.children.length === 0) return depth
  return Math.max(...node.children.map(c => getMaxDepth(c, depth + 1)))
}

// --- SVG Components ---
function TreeEdge({ parent, child }: { parent: LayoutNode; child: LayoutNode }) {
  const x1 = parent.x + NODE_W / 2
  const y1 = parent.y + NODE_H
  const x2 = child.x + NODE_W / 2
  const y2 = child.y
  const midY = (y1 + y2) / 2

  return (
    <path
      d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
      stroke="#a78bfa"
      strokeWidth={2}
      fill="none"
      opacity={0.5}
    />
  )
}

function TreeNode({
  layoutNode,
  isSelected,
  onSelect,
  isCurrent,
}: {
  layoutNode: LayoutNode
  isSelected: boolean
  onSelect: (id: string) => void
  isCurrent: boolean
}) {
  const { node, x, y } = layoutNode
  const score = node.benchmark_score
  const border = isSelected ? '#a78bfa' : isCurrent ? '#28c840' : '#21262d'
  const bg = isSelected ? '#1a1530' : '#111318'

  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect(node.id)}
    >
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={8}
        fill={bg}
        stroke={border}
        strokeWidth={isSelected ? 2 : 1}
      />
      {/* Version label */}
      <text x={x + 12} y={y + 22} fill="#e6edf3" fontSize={14} fontFamily="'Plus Jakarta Sans', sans-serif" fontWeight={600}>
        v{node.version}
      </text>
      {/* Current badge */}
      {isCurrent && (
        <>
          <rect x={x + NODE_W - 68} y={y + 8} width={56} height={20} rx={10} fill="#28c840" opacity={0.15} />
          <text x={x + NODE_W - 58} y={y + 22} fill="#28c840" fontSize={10} fontFamily="'JetBrains Mono', monospace" fontWeight={600}>
            CURRENT
          </text>
        </>
      )}
      {/* Benchmark score */}
      <text x={x + 12} y={y + 46} fill={scoreColor(score)} fontSize={13} fontFamily="'JetBrains Mono', monospace">
        {score != null ? `${Math.round(score)}/100` : 'no benchmark'}
      </text>
      {/* Timestamp */}
      <text x={x + 12} y={y + 66} fill="#484f58" fontSize={11} fontFamily="'Plus Jakarta Sans', sans-serif">
        {timeAgo(node.created_at)}
      </text>
      {/* Model badge */}
      {node.model_id && (
        <text x={x + NODE_W - 12} y={y + 66} fill="#484f58" fontSize={10} fontFamily="'JetBrains Mono', monospace" textAnchor="end">
          {node.model_id}
        </text>
      )}
    </g>
  )
}

function renderTree(
  layoutNode: LayoutNode,
  selectedId: string | null,
  onSelect: (id: string) => void,
  currentVersion: number,
  elements: { edges: React.ReactNode[]; nodes: React.ReactNode[] }
) {
  for (const child of layoutNode.children) {
    elements.edges.push(
      <TreeEdge key={`edge-${layoutNode.node.id}-${child.node.id}`} parent={layoutNode} child={child} />
    )
    renderTree(child, selectedId, onSelect, currentVersion, elements)
  }
  elements.nodes.push(
    <TreeNode
      key={`node-${layoutNode.node.id}`}
      layoutNode={layoutNode}
      isSelected={selectedId === layoutNode.node.id}
      onSelect={onSelect}
      isCurrent={layoutNode.node.version === currentVersion}
    />
  )
}

// --- Main Page ---
export default function GenomeViewerPage() {
  const { agentId } = useParams<{ agentId: string }>()
  const [data, setData] = useState<GenomeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!agentId) return
    fetch(`/api/agents/${agentId}/genome`)
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json()
      })
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [agentId])

  const handleSelect = useCallback((id: string) => {
    setSelectedId(prev => prev === id ? null : id)
  }, [])

  // Find selected node details
  const selectedEntry = data?.timeline.find(t => t.id === selectedId) || null

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0b0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#484f58', fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>
          Loading genome data...
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0b0f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <div style={{ color: '#ff4d4d', fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>
          {error === '404' ? 'Agent not found' : `Error loading genome: ${error}`}
        </div>
        <Link href={`/registry/${agentId}`} style={{ color: '#a78bfa', fontSize: 13, textDecoration: 'none' }}>
          Back to agent profile
        </Link>
      </div>
    )
  }

  const { layout, width, height } = layoutTree(data.tree)
  const elements = { edges: [] as React.ReactNode[], nodes: [] as React.ReactNode[] }
  renderTree(layout, selectedId, handleSelect, data.current_version, elements)

  return (
    <div style={{ minHeight: '100vh', background: '#0a0b0f', color: '#e6edf3', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <Link href={`/registry/${agentId}`} style={{ color: '#484f58', textDecoration: 'none', fontSize: 13 }}>
            ← Agent Profile
          </Link>
          <span style={{ color: '#21262d' }}>|</span>
          <Link href="/observe" style={{ color: '#484f58', textDecoration: 'none', fontSize: 13 }}>
            Observatory
          </Link>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '16px 0 4px', letterSpacing: '-0.02em' }}>
          <span style={{ color: '#a78bfa' }}>⧬</span> Agent Genome Viewer
        </h1>
        <p style={{ color: '#8b949e', fontSize: 14, margin: '0 0 24px' }}>
          Phylogenetic tree of <span style={{ color: '#e6edf3', fontWeight: 600 }}>{data.agent_name}</span> — {data.total_versions} version{data.total_versions !== 1 ? 's' : ''} across Karpathy loop cycles
        </p>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          {[
            { label: 'Current Version', value: `v${data.current_version}`, color: '#e6edf3' },
            { label: 'Benchmark', value: data.current_benchmark != null ? `${Math.round(data.current_benchmark)}/100` : '—', color: scoreColor(data.current_benchmark) },
            { label: 'Total Versions', value: String(data.total_versions), color: '#a78bfa' },
            { label: 'Total Delta', value: data.timeline.length > 1 ? deltaLabel(
              data.timeline.reduce((sum, t) => sum + (t.benchmark_delta || 0), 0)
            ) || '0' : '—', color: deltaColor(data.timeline.reduce((sum, t) => sum + (t.benchmark_delta || 0), 0)) },
          ].map((stat, i) => (
            <div key={i} style={{
              background: '#111318', border: '1px solid #21262d', borderRadius: 8,
              padding: '12px 20px', minWidth: 120, flex: '1 1 120px',
            }}>
              <div style={{ color: '#484f58', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                {stat.label}
              </div>
              <div style={{ color: stat.color, fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tree + Detail split */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 48px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* SVG Tree */}
        <div ref={containerRef} style={{
          flex: '1 1 600px', background: '#111318', border: '1px solid #21262d', borderRadius: 12,
          overflow: 'auto', minHeight: 300, position: 'relative',
        }}>
          <svg
            ref={svgRef}
            width={Math.max(width, 400)}
            height={Math.max(height, 200)}
            viewBox={`0 0 ${Math.max(width, 400)} ${Math.max(height, 200)}`}
            style={{ display: 'block' }}
          >
            {/* Background grid dots */}
            <defs>
              <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="12" cy="12" r="0.5" fill="#21262d" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* Edges first (behind nodes) */}
            {elements.edges}
            {/* Nodes on top */}
            {elements.nodes}
          </svg>
        </div>

        {/* Detail panel */}
        <div style={{
          flex: '0 0 300px', background: '#111318', border: '1px solid #21262d', borderRadius: 12,
          padding: 20, alignSelf: 'flex-start',
        }}>
          {selectedEntry ? (
            <>
              <div style={{ fontSize: 11, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                Version Details
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                v{selectedEntry.version}
              </div>
              {selectedEntry.benchmark_score != null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ color: scoreColor(selectedEntry.benchmark_score), fontSize: 16, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
                    {Math.round(selectedEntry.benchmark_score)}/100
                  </span>
                  {selectedEntry.benchmark_delta != null && (
                    <span style={{
                      color: deltaColor(selectedEntry.benchmark_delta),
                      fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                      background: selectedEntry.benchmark_delta > 0 ? 'rgba(40,200,64,0.1)' : selectedEntry.benchmark_delta < 0 ? 'rgba(255,77,77,0.1)' : 'transparent',
                      padding: '2px 6px', borderRadius: 4,
                    }}>
                      {deltaLabel(selectedEntry.benchmark_delta)} pts
                    </span>
                  )}
                </div>
              )}
              {selectedEntry.change_description && (
                <div style={{ color: '#8b949e', fontSize: 13, lineHeight: 1.5, marginBottom: 12, borderLeft: '2px solid #a78bfa', paddingLeft: 12 }}>
                  {selectedEntry.change_description}
                </div>
              )}
              {selectedEntry.improved_by_name && (
                <div style={{ fontSize: 12, color: '#484f58', marginBottom: 8 }}>
                  Improved by <span style={{ color: '#a78bfa' }}>{selectedEntry.improved_by_name}</span>
                </div>
              )}
              {selectedEntry.model_id && (
                <div style={{ fontSize: 12, color: '#484f58', marginBottom: 8 }}>
                  Model: <span style={{ color: '#e6edf3', fontFamily: "'JetBrains Mono', monospace" }}>{selectedEntry.model_id}</span>
                </div>
              )}
              <div style={{ fontSize: 12, color: '#484f58' }}>
                {timeAgo(selectedEntry.created_at)}
              </div>
            </>
          ) : (
            <div style={{ color: '#484f58', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>
              Click a version node to view details
            </div>
          )}
        </div>
      </div>

      {/* Timeline table */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 64px' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#e6edf3' }}>
          Evolution Timeline
        </h2>
        <div style={{ background: '#111318', border: '1px solid #21262d', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #21262d' }}>
                {['Version', 'Benchmark', 'Delta', 'Change', 'When'].map(h => (
                  <th key={h} style={{
                    padding: '10px 16px', textAlign: 'left', color: '#484f58', fontWeight: 500,
                    fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.timeline.map((entry, i) => (
                <tr
                  key={entry.id}
                  onClick={() => handleSelect(entry.id)}
                  style={{
                    borderBottom: i < data.timeline.length - 1 ? '1px solid #161b22' : 'none',
                    cursor: 'pointer',
                    background: selectedId === entry.id ? '#1a1530' : 'transparent',
                  }}
                >
                  <td style={{ padding: '10px 16px', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
                    v{entry.version}
                    {entry.version === data.current_version && (
                      <span style={{ marginLeft: 8, fontSize: 10, color: '#28c840', background: 'rgba(40,200,64,0.1)', padding: '2px 6px', borderRadius: 4 }}>
                        CURRENT
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 16px', color: scoreColor(entry.benchmark_score), fontFamily: "'JetBrains Mono', monospace" }}>
                    {entry.benchmark_score != null ? `${Math.round(entry.benchmark_score)}/100` : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', color: deltaColor(entry.benchmark_delta), fontFamily: "'JetBrains Mono', monospace" }}>
                    {entry.benchmark_delta != null ? `${deltaLabel(entry.benchmark_delta)} pts` : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', color: '#8b949e', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.change_description || '—'}
                  </td>
                  <td style={{ padding: '10px 16px', color: '#484f58' }}>
                    {timeAgo(entry.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
