'use client'

import Link from 'next/link'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'

// --- Types ---
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

interface TimelineEntry {
  id: string
  version: number
  label: string
  benchmark_score: number | null
  benchmark_delta: number | null
  change_description: string | null
  model_id: string | null
  improved_by_name: string | null
  improved_by_agent_id: string | null
  created_at: string | null
  status: string
}

interface GenomeData {
  agent_id: string
  agent_name: string
  current_version: number
  current_benchmark: number | null
  total_versions: number
  total_delta: number
  improvement_count: number
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
  if (score >= 90) return '#22c55e'
  if (score >= 70) return '#f59e0b'
  if (score >= 50) return '#ff9500'
  return '#ef4444'
}

function nodeScoreColor(score: number | null): string {
  if (score == null) return '#4b5563'
  // Interpolate from red (#ef4444) at 0 to green (#22c55e) at 100
  const t = Math.min(100, Math.max(0, score)) / 100
  const r = Math.round(239 + (34 - 239) * t)
  const g = Math.round(68 + (197 - 68) * t)
  const b = Math.round(68 + (94 - 68) * t)
  return `rgb(${r},${g},${b})`
}

function deltaLabel(delta: number | null): string {
  if (delta == null) return ''
  if (delta > 0) return `+${delta}`
  return `${delta}`
}

function deltaColor(delta: number | null): string {
  if (delta == null) return '#484f58'
  if (delta > 0) return '#22c55e'
  if (delta < 0) return '#ef4444'
  return '#484f58'
}

function statusBadge(status: string): { text: string; color: string; bg: string } {
  switch (status) {
    case 'current': return { text: 'CURRENT', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' }
    case 'survived': return { text: 'SURVIVED', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' }
    case 'extinct': return { text: 'EXTINCT', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
    case 'genesis': return { text: 'GENESIS', color: '#4b5563', bg: 'rgba(75,85,99,0.12)' }
    default: return { text: status.toUpperCase(), color: '#484f58', bg: 'transparent' }
  }
}

// --- Tree Layout ---
interface LayoutNode {
  node: GenomeNode
  x: number
  y: number
  children: LayoutNode[]
}

const NODE_W = 180
const NODE_H = 84
const H_GAP = 32
const V_GAP = 80

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
    width: Math.max(nextX + NODE_W + 40, 500),
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
  const isGhost = child.node.is_ghost

  return (
    <path
      d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
      stroke={isGhost ? '#374151' : '#a78bfa'}
      strokeWidth={isGhost ? 1.5 : 2}
      strokeDasharray={isGhost ? '6 4' : 'none'}
      fill="none"
      opacity={isGhost ? 0.4 : 0.6}
    />
  )
}

function TreeNode({
  layoutNode,
  isSelected,
  onSelect,
  hoveredId,
  onHover,
}: {
  layoutNode: LayoutNode
  isSelected: boolean
  onSelect: (id: string) => void
  hoveredId: string | null
  onHover: (id: string | null) => void
}) {
  const { node, x, y } = layoutNode
  const score = node.benchmark_score
  const isHovered = hoveredId === node.id
  const isGhost = node.is_ghost
  const isExtinct = node.status === 'extinct'
  const isCurrent = node.status === 'current'
  const isGenesis = node.version === 1 && score == null

  // Border color
  let border = '#21262d'
  if (isSelected) border = '#a78bfa'
  else if (isCurrent) border = '#22c55e'
  else if (isHovered) border = '#484f58'
  else if (isGhost) border = '#374151'

  // Background
  let bg = '#111318'
  if (isSelected) bg = '#1a1530'
  else if (isGhost) bg = '#0d0f14'

  // Stroke style
  const strokeDash = (isGenesis || isGhost) ? '4 3' : 'none'

  // Node accent line (left edge color bar)
  const accentColor = isGhost ? '#374151' : isCurrent ? '#22c55e' : nodeScoreColor(score)

  // Score display text
  let scoreText = 'Genesis'
  let scoreTextColor = '#4b5563'
  if (isGhost && score != null) {
    scoreText = `${Math.round(score)}/100`
    scoreTextColor = '#ef4444'
  } else if (score != null) {
    scoreText = `${Math.round(score)}/100`
    scoreTextColor = nodeScoreColor(score)
  } else if (node.version > 1 && !isGhost) {
    scoreText = 'pre-benchmark'
    scoreTextColor = '#374151'
  }

  // Badge
  const badge = statusBadge(node.status)

  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect(node.id)}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Pulse animation ring for current version */}
      {isCurrent && (
        <rect
          x={x - 3}
          y={y - 3}
          width={NODE_W + 6}
          height={NODE_H + 6}
          rx={11}
          fill="none"
          stroke="#22c55e"
          strokeWidth={1.5}
          opacity={0.3}
        >
          <animate attributeName="opacity" values="0.15;0.4;0.15" dur="2.5s" repeatCount="indefinite" />
        </rect>
      )}

      {/* Main rect */}
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={8}
        fill={bg}
        stroke={border}
        strokeWidth={isSelected ? 2 : 1}
        strokeDasharray={strokeDash}
      />

      {/* Left accent bar */}
      <rect x={x} y={y + 8} width={3} height={NODE_H - 16} rx={1.5} fill={accentColor} opacity={isGhost ? 0.4 : 0.8} />

      {/* Version label */}
      <text x={x + 14} y={y + 22} fill={isGhost ? '#484f58' : '#e6edf3'} fontSize={14} fontFamily="'Plus Jakarta Sans', sans-serif" fontWeight={600}>
        {node.label}
      </text>

      {/* Variant label badge (A/B/C) */}
      {node.variant_label && (
        <>
          <rect
            x={x + 14 + (node.label.length * 8.5) + 6}
            y={y + 10}
            width={20}
            height={16}
            rx={4}
            fill={isExtinct ? 'rgba(239,68,68,0.1)' : 'rgba(167,139,250,0.1)'}
          />
          <text
            x={x + 14 + (node.label.length * 8.5) + 16}
            y={y + 22}
            fill={isExtinct ? '#ef4444' : '#a78bfa'}
            fontSize={10}
            fontFamily="'JetBrains Mono', monospace"
            fontWeight={600}
            textAnchor="middle"
          >
            {node.variant_label}
          </text>
        </>
      )}

      {/* Status badge */}
      <rect x={x + NODE_W - 72} y={y + 8} width={60} height={18} rx={9} fill={badge.bg} />
      <text x={x + NODE_W - 42} y={y + 20} fill={badge.color} fontSize={8} fontFamily="'JetBrains Mono', monospace" fontWeight={700} textAnchor="middle">
        {badge.text}
      </text>

      {/* Benchmark score */}
      <text x={x + 14} y={y + 46} fill={scoreTextColor} fontSize={13} fontFamily="'JetBrains Mono', monospace">
        {scoreText}
      </text>

      {/* Timestamp */}
      <text x={x + 14} y={y + 64} fill="#484f58" fontSize={11} fontFamily="'Plus Jakarta Sans', sans-serif">
        {timeAgo(node.created_at)}
      </text>

      {/* Hover hint */}
      {isHovered && !isSelected && (
        <text x={x + NODE_W - 14} y={y + 64} fill="#a78bfa" fontSize={10} fontFamily="'JetBrains Mono', monospace" textAnchor="end" opacity={0.8}>
          details ▸
        </text>
      )}
    </g>
  )
}

function renderTree(
  layoutNode: LayoutNode,
  selectedId: string | null,
  onSelect: (id: string) => void,
  hoveredId: string | null,
  onHover: (id: string | null) => void,
  elements: { edges: React.ReactNode[]; nodes: React.ReactNode[] }
) {
  for (const child of layoutNode.children) {
    elements.edges.push(
      <TreeEdge key={`edge-${layoutNode.node.id}-${child.node.id}`} parent={layoutNode} child={child} />
    )
    renderTree(child, selectedId, onSelect, hoveredId, onHover, elements)
  }
  elements.nodes.push(
    <TreeNode
      key={`node-${layoutNode.node.id}`}
      layoutNode={layoutNode}
      isSelected={selectedId === layoutNode.node.id}
      onSelect={onSelect}
      hoveredId={hoveredId}
      onHover={onHover}
    />
  )
}

// --- Find a node in the tree by id ---
function findNode(root: GenomeNode, id: string): GenomeNode | null {
  if (root.id === id) return root
  for (const child of root.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

// --- Main Page ---
export default function GenomeViewerPage() {
  const { agentId } = useParams<{ agentId: string }>()
  const [data, setData] = useState<GenomeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
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

  const handleHover = useCallback((id: string | null) => {
    setHoveredId(id)
  }, [])

  // Find selected node from tree (works for ghosts too, unlike timeline)
  const selectedNode = data && selectedId ? findNode(data.tree, selectedId) : null
  // Also check timeline for delta info
  const selectedTimeline = data?.timeline.find(t => t.id === selectedId) || null

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
        <div style={{ color: '#ef4444', fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>
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
  renderTree(layout, selectedId, handleSelect, hoveredId, handleHover, elements)

  const totalDeltaDisplay = data.total_delta !== 0 ? deltaLabel(data.total_delta) : '—'
  const totalDeltaColor = data.total_delta > 0 ? '#22c55e' : data.total_delta < 0 ? '#ef4444' : '#484f58'

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
          Phylogenetic tree of <Link href={`/registry/${data.agent_id}`} style={{ color: '#e6edf3', fontWeight: 600, textDecoration: 'none' }}>{data.agent_name}</Link> — {data.total_versions} version{data.total_versions !== 1 ? 's' : ''} across {data.improvement_count} Karpathy loop cycle{data.improvement_count !== 1 ? 's' : ''}
        </p>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          {[
            { label: 'Current Version', value: `v${data.current_version}`, color: '#e6edf3' },
            { label: 'Benchmark', value: data.current_benchmark != null ? `${Math.round(data.current_benchmark)}/100` : '—', color: scoreColor(data.current_benchmark) },
            { label: 'Total Versions', value: String(data.total_versions), color: '#a78bfa' },
            { label: 'Total Delta', value: totalDeltaDisplay, color: totalDeltaColor },
          ].map((stat, i) => (
            <div key={i} style={{
              background: '#111318', border: '1px solid #21262d', borderRadius: 8,
              padding: '12px 20px', minWidth: 120, flex: '1 1 120px',
            }}>
              <div style={{ color: '#484f58', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>
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
          flex: selectedNode ? '1 1 580px' : '1 1 100%',
          background: '#111318', border: '1px solid #21262d', borderRadius: 12,
          overflow: 'auto', minHeight: 300, position: 'relative',
          transition: 'flex 0.3s ease',
        }}>
          <svg
            ref={svgRef}
            width={Math.max(width, 500)}
            height={Math.max(height, 250)}
            viewBox={`0 0 ${Math.max(width, 500)} ${Math.max(height, 250)}`}
            style={{ display: 'block' }}
          >
            {/* Background grid dots */}
            <defs>
              <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="12" cy="12" r="0.6" fill="#1f2937" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />

            {elements.edges}
            {elements.nodes}
          </svg>
        </div>

        {/* Detail panel */}
        <div style={{
          flex: '0 0 320px',
          background: '#111318', border: '1px solid #21262d', borderRadius: 12,
          padding: 24, alignSelf: 'flex-start',
          display: selectedNode ? 'block' : undefined,
        }}>
          {selectedNode ? (
            <SelectedNodePanel node={selectedNode} timeline={selectedTimeline} />
          ) : (
            <EmptyPanel data={data} />
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
                {['Version', 'Status', 'Benchmark', 'Delta', 'Change', 'When'].map(h => (
                  <th key={h} style={{
                    padding: '10px 16px', textAlign: 'left', color: '#484f58', fontWeight: 500,
                    fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.timeline.map((entry, i) => {
                const badge = statusBadge(entry.status)
                return (
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
                      {entry.label}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{
                        fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                        color: badge.color, background: badge.bg, padding: '2px 8px', borderRadius: 4,
                      }}>
                        {badge.text}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', color: scoreColor(entry.benchmark_score), fontFamily: "'JetBrains Mono', monospace" }}>
                      {entry.benchmark_score != null ? `${Math.round(entry.benchmark_score)}/100` : entry.version === 1 ? 'Genesis' : '—'}
                    </td>
                    <td style={{ padding: '10px 16px', color: deltaColor(entry.benchmark_delta), fontFamily: "'JetBrains Mono', monospace" }}>
                      {entry.version === 1 ? <span style={{ color: '#4b5563' }}>Genesis</span> : entry.benchmark_delta != null ? `${deltaLabel(entry.benchmark_delta)} pts` : '—'}
                    </td>
                    <td style={{ padding: '10px 16px', color: '#8b949e', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.change_description ? entry.change_description.slice(0, 120) : '—'}
                    </td>
                    <td style={{ padding: '10px 16px', color: '#484f58' }}>
                      {timeAgo(entry.created_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 48px' }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#484f58' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#22c55e', marginRight: 6, verticalAlign: 'middle' }} />Current version</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#a78bfa', marginRight: 6, verticalAlign: 'middle' }} />Survived variant</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#ef4444', marginRight: 6, verticalAlign: 'middle', opacity: 0.6 }} />Extinct variant</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: '1px dashed #4b5563', marginRight: 6, verticalAlign: 'middle' }} />Genesis / no data</span>
        </div>
      </div>
    </div>
  )
}

// --- Detail panel when a node is selected ---
function SelectedNodePanel({ node, timeline }: { node: GenomeNode; timeline: TimelineEntry | null }) {
  const badge = statusBadge(node.status)
  const score = node.benchmark_score
  const delta = timeline?.benchmark_delta ?? null

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: "'JetBrains Mono', monospace" }}>
          Version Details
        </div>
        <span style={{
          fontSize: 9, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
          color: badge.color, background: badge.bg, padding: '3px 8px', borderRadius: 4,
        }}>
          {badge.text}
        </span>
      </div>

      {/* Version + variant */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>
          {node.label}
        </span>
        {node.variant_label && (
          <span style={{
            fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
            color: node.status === 'extinct' ? '#ef4444' : '#a78bfa',
          }}>
            Variant {node.variant_label}
          </span>
        )}
      </div>

      {/* Benchmark score large */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
        {score != null ? (
          <>
            <span style={{ fontSize: 36, fontWeight: 800, color: nodeScoreColor(score), fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>
              {Math.round(score)}
            </span>
            <span style={{ fontSize: 16, color: '#484f58', fontFamily: "'JetBrains Mono', monospace" }}>/100</span>
            {delta != null && (
              <span style={{
                fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                color: deltaColor(delta),
                background: delta > 0 ? 'rgba(34,197,94,0.1)' : delta < 0 ? 'rgba(239,68,68,0.1)' : 'transparent',
                padding: '2px 8px', borderRadius: 4, marginLeft: 4,
              }}>
                {deltaLabel(delta)} pts
              </span>
            )}
          </>
        ) : (
          <span style={{ fontSize: 16, color: '#4b5563', fontFamily: "'JetBrains Mono', monospace" }}>
            {node.version === 1 ? 'Genesis — no benchmark' : 'Pre-benchmark'}
          </span>
        )}
      </div>

      {/* Change description */}
      {node.change_description && (
        <div style={{
          color: '#8b949e', fontSize: 13, lineHeight: 1.6, marginBottom: 16,
          borderLeft: `2px solid ${node.is_ghost ? '#374151' : '#a78bfa'}`,
          paddingLeft: 12,
        }}>
          {node.change_description.slice(0, 200)}
        </div>
      )}

      {/* Meta info */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {node.improved_by_name && (
          <div style={{ fontSize: 12, color: '#484f58' }}>
            Improved by {node.improved_by_agent_id ? <Link href={`/registry/${node.improved_by_agent_id}`} style={{ color: '#a78bfa', textDecoration: 'none' }}>{node.improved_by_name}</Link> : <span style={{ color: '#a78bfa' }}>{node.improved_by_name}</span>}
          </div>
        )}
        {node.model_id && (
          <div style={{ fontSize: 12, color: '#484f58' }}>
            Model: <span style={{ color: '#e6edf3', fontFamily: "'JetBrains Mono', monospace" }}>{node.model_id}</span>
          </div>
        )}
        <div style={{ fontSize: 12, color: '#484f58' }}>
          {timeAgo(node.created_at)}
        </div>
      </div>
    </>
  )
}

// --- Empty panel when nothing is selected ---
function EmptyPanel({ data }: { data: GenomeData }) {
  return (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>⧬</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3', marginBottom: 4 }}>
        {data.agent_name}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#484f58', marginBottom: 20 }}>
        v{data.current_version} · {data.current_benchmark != null ? `${Math.round(data.current_benchmark)}/100` : 'no benchmark'} · {data.improvement_count} cycle{data.improvement_count !== 1 ? 's' : ''}
      </div>
      <div style={{
        background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 8,
        padding: '12px 16px', marginBottom: 16,
      }}>
        <div style={{ fontSize: 11, color: '#484f58', fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          How to read this tree
        </div>
        <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.6, textAlign: 'left' }}>
          Each node is a version produced by a Karpathy loop cycle. The winning variant survives; extinct variants branch off with dashed lines. Click any node to explore its details.
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#484f58', fontFamily: "'JetBrains Mono', monospace" }}>
        ← Click a node to inspect
      </div>
    </div>
  )
}
