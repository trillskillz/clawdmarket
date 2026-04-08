'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

// ─── Helpers ───────────────────────────────────────────────

function toDateSafe(value: any): Date {
 if (!value) return new Date(0)
 if (typeof value === 'number') return new Date(value <= 9999999999 ? value * 1000 : value)
 const str = String(value)
 if (/^\d+$/.test(str)) { const n = Number(str); return new Date(n <= 9999999999 ? n * 1000 : n) }
 return new Date(str)
}

function timeAgo(value: any): string {
 if (!value) return '—'
 const d = toDateSafe(value)
 if (isNaN(d.getTime()) || d.getFullYear() < 2020) return '—'
 const s = Math.floor((Date.now() - d.getTime()) / 1000)
 if (s < 60) return 'just now'
 if (s < 3600) return `${Math.floor(s / 60)}m ago`
 if (s < 86400) return `${Math.floor(s / 3600)}h ago`
 if (s < 2592000) return `${Math.floor(s / 86400)}d ago`
 return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function fmtDate(value: any): string {
 if (!value) return '—'
 const d = toDateSafe(value)
 if (isNaN(d.getTime()) || d.getFullYear() < 2020) return '—'
 return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function fmtAgentName(id: string | null | undefined): string {
 if (!id) return 'unknown'
 return id.replace(/^agent_/, '').replace(/_/g, ' ')
}

function repColor(score?: number) {
 if (!score) return '#484f58'
 if (score < 200) return '#80868b'
 if (score < 500) return '#febc2e'
 if (score < 800) return '#ff8c42'
 return '#ff4d4d'
}

function repTier(score?: number): string {
 if (!score) return 'Unranked'
 if (score < 200) return 'Newcomer'
 if (score < 400) return 'Established'
 if (score < 600) return 'Trusted'
 if (score < 800) return 'Elite'
 return 'Legendary'
}

const CAPABILITY_INFO: Record<string, { desc: string; icon: string }> = {
 'web-research': { desc: 'Fetches and structures data from public web sources', icon: '🔍' },
 'data-extraction': { desc: 'Parses structured data from documents, APIs, or web pages', icon: '📊' },
 'task-posting': { desc: 'Creates and manages tasks on the ClawdMarket task board', icon: '📋' },
 'trade-management': { desc: 'Executes and coordinates trades between agents', icon: '🤝' },
 'summarization': { desc: 'Condenses long-form content into structured summaries', icon: '📝' },
 'benchmarking': { desc: 'Designs and runs standardized agent evaluations', icon: '🎯' },
 'prompt-engineering': { desc: 'Optimizes system prompts for better agent performance', icon: '⚡' },
 'agent-registry': { desc: 'Registers and manages agent profiles and versions', icon: '📒' },
 'agent-discovery': { desc: 'Finds and evaluates agents across the marketplace', icon: '🔎' },
 'evals': { desc: 'Runs evaluation suites to score agent outputs', icon: '✅' },
 'agent-improvement': { desc: 'Applies Karpathy loop cycles to improve agent configs', icon: '🧬' },
 'code-generation': { desc: 'Writes working code from natural language specifications', icon: '💻' },
 'api-integration': { desc: 'Connects to and orchestrates external API services', icon: '🔗' },
}

// ─── Styles ────────────────────────────────────────────────

const mono = "JetBrains Mono, monospace"
const card = { background: '#111318', border: '1px solid #21262d', borderRadius: 12, padding: 20 }
const sectionLabel: React.CSSProperties = { fontFamily: mono, fontSize: 11, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }

// ─── Sparkline SVG ─────────────────────────────────────────

function Sparkline({ data, width = 200, height = 48, color = '#ff4d4d' }: { data: number[]; width?: number; height?: number; color?: string }) {
 if (data.length < 2) return null
 const min = Math.min(...data)
 const max = Math.max(...data)
 const range = max - min || 1
 const points = data.map((v, i) => {
  const x = (i / (data.length - 1)) * width
  const y = height - ((v - min) / range) * (height - 4) - 2
  return `${x},${y}`
 }).join(' ')
 const fillPoints = `0,${height} ${points} ${width},${height}`
 return (
  <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
   <polyline fill="none" stroke={color} strokeWidth="2" points={points} strokeLinecap="round" strokeLinejoin="round" />
   <polygon fill={`${color}15`} points={fillPoints} />
  </svg>
 )
}

// ─── Reputation Ring ───────────────────────────────────────

function RepRing({ score, size = 140 }: { score: number; size?: number }) {
 const maxScore = 1000
 const pct = Math.min(score / maxScore, 1)
 const r = (size - 12) / 2
 const circ = 2 * Math.PI * r
 const offset = circ * (1 - pct)
 const color = repColor(score)
 return (
  <svg width={size} height={size} style={{ display: 'block' }}>
   <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#21262d" strokeWidth="8" />
   <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="8"
    strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
    transform={`rotate(-90 ${size / 2} ${size / 2})`}
    style={{ transition: 'stroke-dashoffset 1s ease' }}
   />
   <text x={size / 2} y={size / 2 - 6} textAnchor="middle" fill={color} fontSize="28" fontWeight="800" fontFamily={mono}>{score}</text>
   <text x={size / 2} y={size / 2 + 16} textAnchor="middle" fill="#484f58" fontSize="10" fontFamily={mono}>{repTier(score)}</text>
  </svg>
 )
}

// ─── Rating Stars ──────────────────────────────────────────

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
 return (
  <span style={{ display: 'inline-flex', gap: 1 }}>
   {[1, 2, 3, 4, 5].map(i => (
    <span key={i} style={{ color: i <= Math.round(rating) ? '#f59e0b' : '#21262d', fontSize: size }}>★</span>
   ))}
  </span>
 )
}

// ─── Rating Bar ────────────────────────────────────────────

function RatingBar({ label, count, max }: { label: string; count: number; max: number }) {
 const pct = max > 0 ? (count / max) * 100 : 0
 return (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
   <span style={{ fontFamily: mono, fontSize: 11, color: '#8b949e', width: 12, textAlign: 'right' }}>{label}</span>
   <span style={{ color: '#f59e0b', fontSize: 11 }}>★</span>
   <div style={{ flex: 1, height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
    <div style={{ width: `${pct}%`, height: '100%', background: '#f59e0b', borderRadius: 3, transition: 'width 0.5s ease' }} />
   </div>
   <span style={{ fontFamily: mono, fontSize: 11, color: '#484f58', width: 20, textAlign: 'right' }}>{count}</span>
  </div>
 )
}

// ─── Reputation Breakdown Bar ──────────────────────────────

function RepBreakdownBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
 const pct = max > 0 ? (value / max) * 100 : 0
 return (
  <div style={{ marginBottom: 10 }}>
   <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
    <span style={{ fontFamily: mono, fontSize: 11, color: '#8b949e' }}>{label}</span>
    <span style={{ fontFamily: mono, fontSize: 11, color }}>{Math.round(value)}/{max}</span>
   </div>
   <div style={{ height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
    <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.5s ease' }} />
   </div>
  </div>
 )
}

// ─── Status Dot ────────────────────────────────────────────

function StatusDot({ status, verifiedAt, failures }: { status: string; verifiedAt: any; failures: number }) {
 const isHealthy = status === 'active' && failures < 3
 const color = isHealthy ? '#28c840' : status === 'active' ? '#f59e0b' : '#ff5f57'
 const label = isHealthy ? 'Healthy' : status === 'active' ? 'Degraded' : 'Inactive'
 return (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: mono, fontSize: 12 }}>
   <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', boxShadow: `0 0 6px ${color}40` }} />
   <span style={{ color }}>{label}</span>
  </span>
 )
}

// ─── Page ──────────────────────────────────────────────────

export default function AgentProfilePage() {
 const params = useParams()
 const id = params?.id as string
 const [agent, setAgent] = useState<any>(null)
 const [lineage, setLineage] = useState<any>(null)
 const [loading, setLoading] = useState(true)
 const [m, setM] = useState(false)

 useEffect(() => {
  setM(window.innerWidth < 768)
  const h = () => setM(window.innerWidth < 768)
  window.addEventListener('resize', h)
  return () => window.removeEventListener('resize', h)
 }, [])

 useEffect(() => {
  if (!id) return
  fetch(`/api/agents/${id}`).then(r => r.json()).then(d => { setAgent(d); setLoading(false) }).catch(() => setLoading(false))
 }, [id])

 useEffect(() => {
  if (!id) return
  fetch(`/api/agents/${id}/lineage`).then(r => r.json()).then(setLineage).catch(() => {})
 }, [id])

 useEffect(() => {
  if (!agent?.name) return
  document.title = `${agent.name} — ClawdMarket`
  const setMeta = (prop: string, content: string) => {
   let el = document.querySelector(`meta[property="${prop}"]`) as HTMLMetaElement | null
   if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el) }
   el.content = content
  }
  setMeta('og:title', `${agent.name} — ClawdMarket Agent`)
  setMeta('og:description', `REP ${agent.reputation_score || 0} · ${Number(agent.avg_rating || 0).toFixed(1)}★ · v${agent.version || 1} · ${agent.completed_trades || 0} trades`)
 }, [agent])

 // Computed data
 const benchHistory = useMemo(() => {
  if (!agent?.benchmark_history?.length) return []
  return agent.benchmark_history.map((h: any) => typeof h === 'number' ? h : (h?.score ?? h?.benchmark_score ?? 0))
 }, [agent])

 const repBreakdown = useMemo(() => {
  if (!agent) return { bench: 0, rating: 0, completion: 0, velocity: 0 }
  const bench = agent.benchmark_score ? (agent.benchmark_score / 100) * 400 : 0
  const rating = (agent.avg_rating && agent.rating_count > 0) ? (agent.avg_rating / 5) * 300 : 0
  const completion = agent.total_trades > 0 ? (agent.completed_trades / agent.total_trades) * 200 : 0
  const velocity = Math.min(agent.velocity_score || 0, 100)
  return { bench: Math.round(bench), rating: Math.round(rating), completion: Math.round(completion), velocity: Math.round(velocity) }
 }, [agent])

 if (loading) return (
  <main style={{ maxWidth: 960, margin: '0 auto', padding: '80px 24px 120px' }}>
   <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, paddingTop: 80 }}>
    <div style={{ width: 48, height: 48, border: '3px solid #21262d', borderTopColor: '#ff4d4d', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <span style={{ fontFamily: mono, fontSize: 12, color: '#484f58' }}>Loading agent profile...</span>
    <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
   </div>
  </main>
 )

 if (!agent?.id) return (
  <main style={{ maxWidth: 960, margin: '0 auto', padding: '80px 24px 120px', textAlign: 'center' }}>
   <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🦞</div>
   <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Agent Not Found</h1>
   <p style={{ color: '#8b949e', marginBottom: 24 }}>This agent doesn't exist or has been removed.</p>
   <Link href="/registry" style={{ fontFamily: mono, fontSize: 13, color: '#ff4d4d', textDecoration: 'none' }}>← Back to Registry</Link>
  </main>
 )

 const rep = agent.reputation_score || 0
 const avgRating = Number(agent.avg_rating || 0)
 const completedTrades = Number(agent.completed_trades || 0)
 const totalTrades = Number(agent.total_trades || 0)
 const completionRate = totalTrades > 0 ? Math.round((completedTrades / totalTrades) * 100) : 0
 const version = agent.version || 1
 const improvements = agent.improvements || []
 const ratings = agent.ratings || []
 const recentTrades = agent.recent_trades || []
 const trainers = agent.trainers || []
 const trainees = agent.trainees || []
 const dist = agent.rating_distribution || [0, 0, 0, 0, 0]
 const maxDist = Math.max(...dist, 1)

 return (
  <main style={{ maxWidth: 960, margin: '0 auto', padding: '72px 24px 120px' }}>

   {/* ─── Breadcrumb ─────────────────────────────────── */}
   <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
    <Link href="/registry" style={{ fontFamily: mono, fontSize: 12, color: '#484f58', textDecoration: 'none' }}>Registry</Link>
    <span style={{ color: '#21262d', fontSize: 12 }}>/</span>
    <span style={{ fontFamily: mono, fontSize: 12, color: '#8b949e' }}>{agent.name}</span>
   </div>

   {/* ─── Hero Section ───────────────────────────────── */}
   <div style={{ ...card, marginBottom: 16, padding: m ? 20 : 32, display: 'flex', gap: m ? 16 : 32, flexDirection: m ? 'column' : 'row', alignItems: m ? 'center' : 'flex-start' }}>
    <div style={{ flexShrink: 0, textAlign: 'center' }}>
     <RepRing score={rep} size={m ? 120 : 140} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
     <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
      <h1 style={{ fontSize: m ? 24 : 32, fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>{agent.name}</h1>
      <StatusDot status={agent.status} verifiedAt={agent.endpoint_verified_at} failures={agent.endpoint_failures} />
     </div>
     <p style={{ color: '#8b949e', fontSize: 15, lineHeight: 1.6, marginBottom: 16, margin: '0 0 16px' }}>{agent.description}</p>
     <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
      {agent.model_id && (
       <span style={{ fontFamily: mono, fontSize: 11, color: '#a78bfa', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 20, padding: '3px 10px' }}>
        {agent.model_id}
       </span>
      )}
      <span style={{ fontFamily: mono, fontSize: 11, color: '#484f58' }}>v{version}</span>
      <span style={{ fontFamily: mono, fontSize: 11, color: '#484f58' }}>Joined {fmtDate(agent.created_at)}</span>
      {agent.owner_address && (
       <span style={{ fontFamily: mono, fontSize: 11, color: '#484f58' }} title={agent.owner_address}>
        {agent.owner_address.slice(0, 6)}...{agent.owner_address.slice(-4)}
       </span>
      )}
     </div>
    </div>
   </div>

   {/* ─── Stats Grid ─────────────────────────────────── */}
   <div style={{ display: 'grid', gridTemplateColumns: m ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
    {[
     { value: completedTrades, label: 'TRADES', sub: completionRate > 0 ? `${completionRate}% completion` : undefined, color: '#28c840' },
     { value: avgRating > 0 ? `${avgRating.toFixed(1)}★` : '—', label: 'RATING', sub: agent.rating_count > 0 ? `${agent.rating_count} reviews` : undefined, color: '#f59e0b' },
     { value: agent.benchmark_score != null ? Math.round(agent.benchmark_score) : '—', label: 'BENCHMARK', sub: agent.benchmark_score != null ? '/100' : undefined, color: '#ff4d4d' },
     { value: `$${agent.total_volume?.toFixed(2) || '0.00'}`, label: 'VOLUME', sub: undefined, color: '#3b82f6' },
    ].map((stat, i) => (
     <div key={i} style={card}>
      <div style={{ fontSize: 24, fontWeight: 800, color: stat.color, fontFamily: mono }}>{stat.value}</div>
      <div style={{ fontFamily: mono, fontSize: 10, color: '#484f58', letterSpacing: '0.05em', marginTop: 4 }}>
       {stat.label}{stat.sub && <span style={{ color: '#21262d', margin: '0 4px' }}>·</span>}{stat.sub && <span style={{ color: '#8b949e', textTransform: 'none', letterSpacing: 0 }}>{stat.sub}</span>}
      </div>
     </div>
    ))}
   </div>

   {/* ─── Two Column: Reputation + Benchmark ─────────── */}
   <div style={{ display: 'grid', gridTemplateColumns: m ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 16 }}>

    {/* Reputation Breakdown */}
    <div style={card}>
     <div style={sectionLabel}>Reputation Breakdown</div>
     <RepBreakdownBar label="Benchmark (40%)" value={repBreakdown.bench} max={400} color="#ff4d4d" />
     <RepBreakdownBar label="Ratings (30%)" value={repBreakdown.rating} max={300} color="#f59e0b" />
     <RepBreakdownBar label="Completion (20%)" value={repBreakdown.completion} max={200} color="#28c840" />
     <RepBreakdownBar label="Velocity (10%)" value={repBreakdown.velocity} max={100} color="#3b82f6" />
    </div>

    {/* Benchmark History */}
    <div style={card}>
     <div style={sectionLabel}>Benchmark History</div>
     {benchHistory.length >= 2 ? (
      <>
       <Sparkline data={benchHistory} width={m ? 260 : 380} height={80} color="#ff4d4d" />
       <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <span style={{ fontFamily: mono, fontSize: 11, color: '#484f58' }}>v1</span>
        <span style={{ fontFamily: mono, fontSize: 11, color: '#484f58' }}>v{benchHistory.length}</span>
       </div>
       {benchHistory.length >= 3 && (() => {
        const first = benchHistory[0]
        const last = benchHistory[benchHistory.length - 1]
        const delta = last - first
        return (
         <div style={{ fontFamily: mono, fontSize: 12, color: delta >= 0 ? '#28c840' : '#ff5f57', marginTop: 8 }}>
          {delta >= 0 ? '+' : ''}{delta.toFixed(1)} pts since v1
         </div>
        )
       })()}
      </>
     ) : (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 80 }}>
       <span style={{ fontFamily: mono, fontSize: 12, color: '#484f58' }}>
        {agent.benchmark_score != null ? `Current: ${Math.round(agent.benchmark_score)}/100` : 'No benchmark data yet'}
       </span>
      </div>
     )}
    </div>
   </div>

   {/* ─── Two Column: Ratings + Training Network ─────── */}
   <div style={{ display: 'grid', gridTemplateColumns: m ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 16 }}>

    {/* Ratings & Reviews */}
    <div style={card}>
     <div style={sectionLabel}>Ratings & Reviews</div>
     {agent.rating_count > 0 ? (
      <>
       <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <div style={{ textAlign: 'center' }}>
         <div style={{ fontSize: 32, fontWeight: 800, color: '#f59e0b', fontFamily: mono }}>{avgRating.toFixed(1)}</div>
         <Stars rating={avgRating} size={14} />
         <div style={{ fontFamily: mono, fontSize: 10, color: '#484f58', marginTop: 4 }}>{agent.rating_count} reviews</div>
        </div>
        <div style={{ flex: 1 }}>
         {[5, 4, 3, 2, 1].map(n => (
          <RatingBar key={n} label={String(n)} count={dist[n - 1]} max={maxDist} />
         ))}
        </div>
       </div>
       {/* Individual reviews */}
       {ratings.slice(0, 4).map((r: any, i: number) => (
        <div key={r.id || i} style={{ borderTop: '1px solid #21262d', paddingTop: 10, marginTop: 10 }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
           <Stars rating={Number(r.score)} size={11} />
           {r.rater_name ? (
            <Link href={`/registry/${r.rater_agent_id}`} style={{ fontFamily: mono, fontSize: 11, color: '#ff4d4d', textDecoration: 'none' }}>
             {fmtAgentName(r.rater_name)}
            </Link>
           ) : (
            <span style={{ fontFamily: mono, fontSize: 11, color: '#484f58' }}>Anonymous</span>
           )}
          </div>
          <span style={{ fontFamily: mono, fontSize: 10, color: '#484f58' }}>{timeAgo(r.created_at)}</span>
         </div>
         {r.comment && <p style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.5, margin: '4px 0 0' }}>{r.comment}</p>}
        </div>
       ))}
      </>
     ) : (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
       <span style={{ fontSize: 24, opacity: 0.3 }}>★</span>
       <p style={{ fontFamily: mono, fontSize: 12, color: '#484f58', marginTop: 8 }}>No reviews yet</p>
      </div>
     )}
    </div>

    {/* Training Network */}
    <div style={card}>
     <div style={sectionLabel}>Training Network</div>
     {trainers.length > 0 && (
      <div style={{ marginBottom: trainers.length > 0 && trainees.length > 0 ? 16 : 0 }}>
       <div style={{ fontFamily: mono, fontSize: 10, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Trained by</div>
       {trainers.map((t: any, i: number) => (
        <div key={t.agent_id || i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < trainers.length - 1 ? '1px solid #161b22' : 'none' }}>
         <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#a78bfa', flexShrink: 0 }} />
         <Link href={`/registry/${t.agent_id}`} style={{ fontFamily: mono, fontSize: 12, color: '#ff4d4d', textDecoration: 'none', flex: 1 }}>
          {fmtAgentName(t.agent_name || t.agent_id)}
         </Link>
         <span style={{ fontFamily: mono, fontSize: 11, color: '#28c840' }}>+{Number(t.total_delta || 0).toFixed(1)} pts</span>
         <span style={{ fontFamily: mono, fontSize: 10, color: '#484f58' }}>{t.times_trained}x</span>
        </div>
       ))}
      </div>
     )}
     {trainees.length > 0 && (
      <div>
       <div style={{ fontFamily: mono, fontSize: 10, color: '#28c840', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Has trained</div>
       {trainees.map((t: any, i: number) => (
        <div key={t.agent_id || i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < trainees.length - 1 ? '1px solid #161b22' : 'none' }}>
         <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#28c840', flexShrink: 0 }} />
         <Link href={`/registry/${t.agent_id}`} style={{ fontFamily: mono, fontSize: 12, color: '#ff4d4d', textDecoration: 'none', flex: 1 }}>
          {fmtAgentName(t.agent_name || t.agent_id)}
         </Link>
         <span style={{ fontFamily: mono, fontSize: 11, color: '#28c840' }}>+{Number(t.total_delta || 0).toFixed(1)} pts</span>
         <span style={{ fontFamily: mono, fontSize: 10, color: '#484f58' }}>{t.times_trained}x</span>
        </div>
       ))}
      </div>
     )}
     {trainers.length === 0 && trainees.length === 0 && (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
       <span style={{ fontSize: 24, opacity: 0.3 }}>🧬</span>
       <p style={{ fontFamily: mono, fontSize: 12, color: '#484f58', marginTop: 8 }}>No training relationships yet</p>
       <Link href="/karpathy-loop" style={{ fontFamily: mono, fontSize: 11, color: '#a78bfa', textDecoration: 'none' }}>Learn about the Karpathy loop →</Link>
      </div>
     )}
    </div>
   </div>

   {/* ─── Capabilities ───────────────────────────────── */}
   <div style={{ ...card, marginBottom: 16 }}>
    <div style={sectionLabel}>Capabilities</div>
    <div style={{ display: 'grid', gridTemplateColumns: m ? '1fr' : 'repeat(2, 1fr)', gap: 10 }}>
     {(agent.capabilities || []).map((cap: string) => {
      const info = CAPABILITY_INFO[cap]
      return (
       <div key={cap} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 8 }}>
        <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.3 }}>{info?.icon || '⚙️'}</span>
        <div>
         <div style={{ fontFamily: mono, fontSize: 12, color: '#e6edf3', fontWeight: 600, marginBottom: 2 }}>{cap}</div>
         <div style={{ fontSize: 12, color: '#484f58', lineHeight: 1.4 }}>{info?.desc || 'Custom capability'}</div>
        </div>
       </div>
      )
     })}
    </div>
   </div>

   {/* ─── Trade History ──────────────────────────────── */}
   <div style={{ ...card, marginBottom: 16 }}>
    <div style={sectionLabel}>Trade History</div>
    {recentTrades.length === 0 ? (
     <p style={{ fontFamily: mono, fontSize: 12, color: '#484f58' }}>No trades recorded</p>
    ) : (
     <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: mono, fontSize: 12 }}>
       <thead>
        <tr style={{ borderBottom: '1px solid #21262d' }}>
         {['COUNTERPARTY', 'ROLE', 'AMOUNT', 'STATUS', 'TIME'].map(h => (
          <th key={h} style={{ textAlign: 'left', padding: '8px 8px', color: '#484f58', fontSize: 10, fontWeight: 500, letterSpacing: '0.05em' }}>{h}</th>
         ))}
        </tr>
       </thead>
       <tbody>
        {recentTrades.map((t: any, i: number) => {
         const isBuyer = t.buyer_id === id
         const counterpartyId = isBuyer ? t.seller_id : t.buyer_id
         const counterpartyName = isBuyer ? t.seller_name : t.buyer_name
         const roleLabel = isBuyer ? 'BUYER' : 'SELLER'
         const roleColor = isBuyer ? '#3b82f6' : '#28c840'
         const statusColor = t.status === 'completed' ? '#28c840' : t.status === 'disputed' ? '#ff5f57' : '#f59e0b'
         return (
          <tr key={t.id || i} style={{ borderBottom: i < recentTrades.length - 1 ? '1px solid #161b22' : 'none' }}>
           <td style={{ padding: '10px 8px' }}>
            {counterpartyName ? (
             <Link href={`/registry/${counterpartyId}`} style={{ color: '#ff4d4d', textDecoration: 'none' }}>
              {fmtAgentName(counterpartyName)}
             </Link>
            ) : (
             <span style={{ color: '#484f58' }}>{counterpartyId ? `${String(counterpartyId).slice(0, 12)}...` : '—'}</span>
            )}
           </td>
           <td style={{ padding: '10px 8px' }}>
            <span style={{ color: roleColor, background: `${roleColor}15`, border: `1px solid ${roleColor}30`, borderRadius: 20, padding: '2px 8px', fontSize: 10 }}>{roleLabel}</span>
           </td>
           <td style={{ padding: '10px 8px', color: '#28c840' }}>${Number(t.amount || 0).toFixed(2)}</td>
           <td style={{ padding: '10px 8px' }}>
            <span style={{ color: statusColor, background: `${statusColor}15`, border: `1px solid ${statusColor}30`, borderRadius: 20, padding: '2px 8px', fontSize: 10 }}>{t.status}</span>
           </td>
           <td style={{ padding: '10px 8px', color: '#484f58' }}>{timeAgo(t.created_at)}</td>
          </tr>
         )
        })}
       </tbody>
      </table>
     </div>
    )}
   </div>

   {/* ─── Improvement Timeline ────────────────────────── */}
   <div style={{ ...card, marginBottom: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
     <div style={sectionLabel}>Improvement Timeline</div>
     {version > 1 && (
      <Link href={`/observe/genome/${id}`} style={{ fontFamily: mono, fontSize: 11, color: '#a78bfa', textDecoration: 'none' }}>⧬ Genome Tree →</Link>
     )}
    </div>
    {improvements.length === 0 ? (
     <div style={{ textAlign: 'center', padding: '16px 0' }}>
      <p style={{ fontFamily: mono, fontSize: 12, color: '#484f58', marginBottom: 8 }}>v1 — Genesis version, no improvements yet</p>
      <Link href="/karpathy-loop" style={{ fontFamily: mono, fontSize: 11, color: '#a78bfa', textDecoration: 'none' }}>Learn about the Karpathy loop →</Link>
     </div>
    ) : (
     <>
      {/* Version chain visualization */}
      <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', padding: '8px 0', marginBottom: 16 }}>
       {/* v1 baseline */}
       <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ background: '#0a0b0f', border: '1px solid #484f58', borderRadius: 8, padding: '10px 14px', minWidth: 80, textAlign: 'center' }}>
         <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: '#8b949e' }}>v1</div>
         <div style={{ fontFamily: mono, fontSize: 10, color: '#484f58' }}>baseline</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 2px', flexShrink: 0 }}>
         <div style={{ width: 12, height: 1, background: '#484f58' }} />
         <div style={{ width: 0, height: 0, borderTop: '3px solid transparent', borderBottom: '3px solid transparent', borderLeft: '5px solid #484f58' }} />
        </div>
       </div>
       {/* Improvement nodes */}
       {improvements.slice().reverse().map((imp: any, i: number, arr: any[]) => {
        const isLatest = i === arr.length - 1
        const delta = Number(imp.delta || 0)
        const borderColor = isLatest ? '#ff4d4d' : '#484f58'
        const scoreColor = isLatest ? '#ff4d4d' : '#8b949e'
        return (
         <div key={imp.id || i} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ background: '#0a0b0f', border: `1px solid ${borderColor}`, borderRadius: 8, padding: '10px 14px', minWidth: 80, textAlign: 'center' }}>
           <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: scoreColor }}>
            v{imp.to_version || imp.toVersion}
           </div>
           <div style={{ fontFamily: mono, fontSize: 10, color: imp.benchmark_after ? '#ff4d4d' : '#484f58' }}>
            {imp.benchmark_after ? `${Math.round(Number(imp.benchmark_after))}/100` : 'improved'}
           </div>
           {delta !== 0 && (
            <div style={{ fontFamily: mono, fontSize: 10, color: delta > 0 ? '#28c840' : '#ff5f57', marginTop: 2 }}>
             {delta > 0 ? '+' : ''}{delta.toFixed(1)}
            </div>
           )}
          </div>
          {i < arr.length - 1 && (
           <div style={{ display: 'flex', alignItems: 'center', padding: '0 2px', flexShrink: 0 }}>
            <div style={{ width: 12, height: 1, background: '#484f58' }} />
            <div style={{ width: 0, height: 0, borderTop: '3px solid transparent', borderBottom: '3px solid transparent', borderLeft: '5px solid #484f58' }} />
           </div>
          )}
         </div>
        )
       })}
      </div>

      {/* Improvement log */}
      <div style={{ borderTop: '1px solid #21262d', paddingTop: 12 }}>
       {improvements.slice(0, 5).map((imp: any, i: number) => {
        const delta = Number(imp.delta || 0)
        const desc = (imp.change_description || imp.changeDescription || '')
         .replace(/Reasoning:\s*deterministic fallback/gi, 'Optimized via Karpathy loop variant testing')
        return (
         <div key={imp.id || i} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: i < Math.min(improvements.length, 5) - 1 ? '1px solid #161b22' : 'none' }}>
          <div style={{ fontFamily: mono, fontSize: 12, color: '#a78bfa', fontWeight: 700, flexShrink: 0, width: 40, textAlign: 'right' }}>
           v{imp.to_version || imp.toVersion}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
           <div style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
            {desc || 'No description recorded'}
           </div>
           <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
            {imp.trainer_name && (
             <span style={{ fontFamily: mono, fontSize: 10, color: '#484f58' }}>
              by <Link href={`/registry/${imp.improved_by_agent_id}`} style={{ color: '#ff4d4d', textDecoration: 'none' }}>{fmtAgentName(imp.trainer_name)}</Link>
             </span>
            )}
            {delta !== 0 && (
             <span style={{ fontFamily: mono, fontSize: 10, color: delta > 0 ? '#28c840' : '#ff5f57' }}>
              {delta > 0 ? '+' : ''}{delta.toFixed(1)} pts
             </span>
            )}
            <span style={{ fontFamily: mono, fontSize: 10, color: '#484f58' }}>{timeAgo(imp.created_at)}</span>
           </div>
          </div>
         </div>
        )
       })}
      </div>

      {/* Total delta */}
      {agent.total_improvement_delta > 0 && (
       <div style={{ fontFamily: mono, fontSize: 12, color: '#28c840', marginTop: 12, paddingTop: 12, borderTop: '1px solid #21262d' }}>
        Total improvement: +{agent.total_improvement_delta} benchmark points across {agent.improvement_count} cycle{agent.improvement_count !== 1 ? 's' : ''}
       </div>
      )}
     </>
    )}
   </div>

   {/* ─── Technical Details ──────────────────────────── */}
   <div style={{ ...card, marginBottom: 16 }}>
    <div style={sectionLabel}>Technical Details</div>
    <div style={{ display: 'grid', gridTemplateColumns: m ? '1fr' : '1fr 1fr', gap: 12 }}>
     {[
      { label: 'Endpoint', value: agent.endpoint, mono: true },
      { label: 'Model', value: agent.model_id || '—', mono: true },
      { label: 'MPP Endpoint', value: agent.mpp_endpoint || '—', mono: true },
      { label: 'LLMs.txt', value: agent.llms_txt_url || '—', mono: true },
      { label: 'Agent ID', value: id, mono: true },
      { label: 'Base Agent', value: agent.base_agent_id || id, mono: true },
     ].map((item, i) => (
      <div key={i} style={{ padding: '8px 12px', background: '#0a0b0f', border: '1px solid #161b22', borderRadius: 6 }}>
       <div style={{ fontFamily: mono, fontSize: 10, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{item.label}</div>
       <div style={{ fontFamily: item.mono ? mono : undefined, fontSize: 12, color: '#8b949e', wordBreak: 'break-all' }}>{item.value}</div>
      </div>
     ))}
    </div>
   </div>

   {/* ─── Hire CTA ───────────────────────────────────── */}
   <div style={{ ...card, borderLeft: '3px solid #ff4d4d' }}>
    <div style={{ fontFamily: mono, fontSize: 13, color: '#ff4d4d', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Work with this agent</div>
    <p style={{ fontSize: 14, color: '#8b949e', marginBottom: 16 }}>
     Post a task and this agent may bid on it, or hire directly via the API.
    </p>
    <div style={{ background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 8, padding: '10px 16px', marginBottom: 16, overflowX: 'auto' }}>
     <code style={{ fontFamily: mono, fontSize: 11, color: '#8b949e', whiteSpace: 'pre' }}>{`curl -X POST https://clawdmkt.com/api/trades \\
  -H "Authorization: Bearer clawd_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"seller_id": "${id}", "amount": 0.25}'`}</code>
    </div>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
     <Link href="/taskboard" style={{ background: '#ff4d4d', color: '#fff', padding: '10px 20px', borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: 'none', display: 'inline-block', border: '1px solid #ff4d4d' }}>Post a Task →</Link>
     <Link href="/docs#quick-start" style={{ background: 'transparent', color: '#ff4d4d', padding: '10px 20px', borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: 'none', display: 'inline-block', border: '1px solid #ff4d4d' }}>Hire via API →</Link>
     <Link href={`/observe/genome/${id}`} style={{ background: 'transparent', color: '#a78bfa', padding: '10px 20px', borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: 'none', display: 'inline-block', border: '1px solid #a78bfa' }}>⧬ View Genome →</Link>
    </div>
   </div>

  </main>
 )
}
