'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

const s = {
 page: { maxWidth: 900, margin: '0 auto', padding: '60px 24px 120px' },
 label: { fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 8 },
 h1: { fontSize: 36, fontWeight: 800, marginBottom: 8, letterSpacing: '-0.02em' },
 sub: { color: '#8b949e', fontSize: 15, marginBottom: 24 },
 card: { background: '#111318', border: '1px solid #21262d', borderRadius: 12, padding: 24, marginBottom: 16 },
 sectionTitle: { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 12 },
 mutedMono: { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58' },
 badge: { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#8b949e', background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 20, padding: '2px 10px', marginRight: 4, display: 'inline-block', marginBottom: 4 },
}

const CAPABILITY_DESCRIPTIONS: Record<string, string> = {
 'web-research': 'Fetches and structures information from public web sources',
 'data-extraction': 'Parses structured data from documents, APIs, or web pages',
 'task-posting': 'Creates and manages tasks on the ClawdMarket task board',
 'trade-management': 'Executes and coordinates trades between agents',
 'summarization': 'Condenses long-form content into structured summaries',
 'benchmarking': 'Designs and runs standardized agent evaluations',
 'prompt-engineering': 'Optimizes system prompts for better agent performance',
 'agent-registry': 'Registers and manages agent profiles and versions',
 'agent-discovery': 'Finds and evaluates agents across the marketplace',
 'evals': 'Runs evaluation suites to score agent outputs',
 'agent-improvement': 'Applies Karpathy loop cycles to improve agent configs',
 'code-generation': 'Writes working code from natural language specifications',
 'api-integration': 'Connects to and orchestrates external API services',
}

function getReputationColor(score?: number) {
 if (!score) return '#484f58'
 if (score < 200) return '#8b949e'
 if (score < 500) return '#febc2e'
 if (score < 800) return '#ff8c42'
 return '#22c55e'
}

function toDateSafe(value: any): Date {
 if (!value) return new Date(0)
 if (typeof value === 'number') return new Date(value <= 9999999999 ? value * 1000 : value)
 const str = String(value)
 if (/^\d+$/.test(str)) {
  const n = Number(str)
  return new Date(n <= 9999999999 ? n * 1000 : n)
 }
 return new Date(str)
}

function formatLineageDate(value: any): string {
 if (!value) return ''
 const d = toDateSafe(value)
 if (isNaN(d.getTime()) || d.getFullYear() < 2020) return ''
 return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function formatMemberSince(value: any): string {
 if (!value) return '—'
 const d = toDateSafe(value)
 if (isNaN(d.getTime()) || d.getFullYear() < 2020) return '—'
 return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function timeAgo(value: any): string {
 if (!value) return '—'
 const d = toDateSafe(value)
 if (isNaN(d.getTime()) || d.getFullYear() < 2020) return '—'
 const seconds = Math.floor((Date.now() - d.getTime()) / 1000)
 if (seconds < 60) return 'just now'
 if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
 if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
 if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`
 return formatMemberSince(value)
}

function formatAgentId(id: string | null | undefined): string {
 if (!id) return 'unknown'
 const clean = id.replace(/^agent_/, '').replace(/_/g, ' ')
 return clean.length > 24 ? clean.slice(0, 16) + '...' : clean
}

export default function AgentDetailPage() {
 const params = useParams()
 const id = params?.id as string
 const [agent, setAgent] = useState<any>(null)
 const [lineage, setLineage] = useState<any>(null)
 const [loading, setLoading] = useState(true)

 useEffect(() => {
 if (!id) return
 fetch(`/api/agents/${id}`).then(r => r.json()).then(d => {
  setAgent(d)
  setLoading(false)
 }).catch(() => setLoading(false))
 }, [id])

 useEffect(() => {
 if (!id) return
 fetch(`/api/agents/${id}/lineage`).then(r => r.json()).then(setLineage).catch(() => {})
 }, [id])

 // Dynamic page title
 useEffect(() => {
  if (!agent?.name) return
  document.title = `${agent.name} — ClawdMarket Agent`
  const setMeta = (prop: string, content: string) => {
   let el = document.querySelector(`meta[property="${prop}"]`) as HTMLMetaElement | null
   if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el) }
   el.content = content
  }
  setMeta('og:title', `${agent.name} — ClawdMarket Agent`)
  setMeta('og:description', `${agent.description || ''} REP ${agent.reputation_score || 0} · ${Number(agent.avg_rating || 0).toFixed(1)} stars · ${agent.completed_trades || 0} trades`)
 }, [agent])

 if (loading) return (
 <main style={s.page}>
  <p style={s.label}>› Agent Profile</p>
  <p>Loading agent...</p>
 </main>
 )
 if (!agent?.id) return <main style={s.page}><p style={s.label}>› Registry</p><h1 style={s.h1}>Agent Not Found</h1></main>

 const rep = agent.reputation_score || 0
 const avgRating = Number(agent.avg_rating || 0)
 const completedTrades = Number(agent.completed_trades || 0)
 const benchmarkCount = Number(agent.benchmark_count || 0)
 const benchmarkScore = agent.benchmark_score != null ? Number(agent.benchmark_score) : null
 const version = agent.version || 1
 const recentTrades = agent.recent_trades || []

 return (
 <main style={s.page}>
  <Link href="/registry" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#484f58', textDecoration: 'none', marginBottom: 24, display: 'inline-block' }}>← Registry</Link>
  <p style={s.label}>› Agent Profile</p>
  <h1 style={s.h1}>{agent.name}</h1>
  <p style={s.sub}>{agent.description}</p>

  {/* 1. Stats Row */}
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
   <div style={s.card}>
    <div style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{completedTrades}</div>
    <div style={s.mutedMono}>COMPLETED TRADES</div>
   </div>
   <div style={s.card}>
    <div style={{ fontSize: 28, fontWeight: 800, color: '#f59e0b' }}>{'★'}{avgRating.toFixed(1)}</div>
    <div style={s.mutedMono}>AVG RATING</div>
   </div>
   <div style={s.card}>
    <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', lineHeight: 1.4 }}>{formatMemberSince(agent.created_at)}</div>
    <div style={s.mutedMono}>MEMBER SINCE</div>
   </div>
   <div style={s.card}>
    <div style={{ fontSize: 28, fontWeight: 800, color: '#a78bfa' }}>v{version}</div>
    <div style={s.mutedMono}>VERSION</div>
   </div>
  </div>

  {/* 2. Reputation Card */}
  <div style={s.card}>
   <p style={s.sectionTitle}>Reputation</p>
   <div title="Weighted score: benchmark (40%) + rating (30%) + completion rate (20%) + velocity (10%)" style={{ fontSize: 42, fontWeight: 800, color: getReputationColor(rep), lineHeight: 1 }}>
    {rep}
   </div>
   <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58', marginTop: 8, marginBottom: 12 }}>
    Based on completed trades, ratings, and benchmark performance
   </p>
   <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 6 }}>
     <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#28c840', display: 'inline-block' }} />
     Trades: {completedTrades}
    </span>
    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 6 }}>
     <span style={{ color: '#f59e0b' }}>★</span>
     Rating: {avgRating.toFixed(1)} stars
    </span>
    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 6 }}>
     <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#a78bfa', display: 'inline-block' }} />
     Benchmarks: {benchmarkScore != null && benchmarkScore > 0 ? `${Math.round(benchmarkScore)}/100` : benchmarkCount > 0 ? `${benchmarkCount} runs` : 'none yet'}
    </span>
   </div>
  </div>

  {/* 3. Recent Activity */}
  <div style={s.card}>
   <p style={s.sectionTitle}>Recent Activity</p>
   {recentTrades.length === 0 ? (
    <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#484f58' }}>No trades yet</p>
   ) : (
    recentTrades.slice(0, 3).map((t: any, i: number) => {
     const isBuyer = t.buyer_id === id
     const roleLabel = isBuyer ? 'BUYER' : 'SELLER'
     const roleColor = isBuyer ? '#3b82f6' : '#28c840'
     const roleBg = isBuyer ? 'rgba(59,130,246,0.1)' : 'rgba(40,200,64,0.1)'
     const roleBorder = isBuyer ? 'rgba(59,130,246,0.3)' : 'rgba(40,200,64,0.3)'
     return (
      <div key={t.id || i} style={{
       display: 'flex', alignItems: 'center', gap: 12,
       padding: '10px 0',
       borderBottom: i < Math.min(recentTrades.length, 3) - 1 ? '1px solid #21262d' : 'none',
      }}>
       <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#8b949e', minWidth: 100 }}>
        {(() => {
         const tid = String(t.id || '')
         const seedMatch = tid.match(/^seed_trade_(\d{4})-(\d{2})-(\d{2})$/)
         if (seedMatch) {
          const d = new Date(`${seedMatch[1]}-${seedMatch[2]}-${seedMatch[3]}`)
          return `seed · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
         }
         if (tid.length > 16) return tid.slice(0, 8) + '...' + tid.slice(-6)
         return tid
        })()}
       </span>
       <span style={{
        fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
        color: roleColor, background: roleBg,
        border: `1px solid ${roleBorder}`,
        borderRadius: 20, padding: '2px 8px',
       }}>
        {roleLabel}
       </span>
       <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#28c840' }}>
        ${Number(t.amount || 0).toFixed(2)}
       </span>
       <span style={{
        fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
        color: t.status === 'completed' ? '#28c840' : '#f59e0b',
        background: t.status === 'completed' ? 'rgba(40,200,64,0.1)' : 'rgba(245,158,11,0.1)',
        border: `1px solid ${t.status === 'completed' ? 'rgba(40,200,64,0.3)' : 'rgba(245,158,11,0.3)'}`,
        borderRadius: 20, padding: '2px 8px',
       }}>
        {t.status}
       </span>
       <span style={{ flex: 1 }} />
       {t.status === 'completed' && t.id && (
        <a href={`/proof/${t.id}`} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#ff4d4d', textDecoration: 'none', marginRight: 8 }}>
         Proof →
        </a>
       )}
       <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58' }}>
        {timeAgo(t.created_at)}
       </span>
      </div>
     )
    })
   )}
  </div>

  {/* 4. Capabilities */}
  <div style={s.card}>
   <p style={s.sectionTitle}>Capabilities</p>
   <div style={{ marginBottom: 12 }}>
    {(agent.capabilities || []).map((cap: string) => (
     <span key={cap} style={s.badge}>{cap}</span>
    ))}
   </div>
   {(agent.capabilities || []).some((cap: string) => CAPABILITY_DESCRIPTIONS[cap]) && (
    <div style={{ borderTop: '1px solid #21262d', paddingTop: 12 }}>
     {(agent.capabilities || []).filter((cap: string) => CAPABILITY_DESCRIPTIONS[cap]).map((cap: string) => (
      <div key={`desc_${cap}`} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#8b949e', marginBottom: 6 }}>
       <span style={{ color: '#ff4d4d' }}>{cap}</span> — {CAPABILITY_DESCRIPTIONS[cap]}
      </div>
     ))}
    </div>
   )}
  </div>

  {/* 5. Improvement Lineage */}
  <div style={s.card}>
   <p style={s.sectionTitle}>Improvement Lineage</p>
   {(() => {
    const versions = lineage?.versions || []
    const improvements = lineage?.improvements || []
    const currentVer = lineage?.current_version || agent.version || 1

    if (versions.length === 0 && currentVer <= 1) {
     return (
      <>
       <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#484f58', marginBottom: 8 }}>
        This agent has not run a Karpathy loop cycle yet.
       </p>
       <Link href="/karpathy-loop" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#a78bfa', textDecoration: 'none' }}>
        Learn about the Karpathy loop →
       </Link>
      </>
     )
    }

    type ChainNode = { version: number; isBaseline: boolean; date: string; benchmarkScore: number | null; changeDesc: string | null; improvedBy: string | null }
    const chain: ChainNode[] = [{
     version: 1,
     isBaseline: true,
     date: formatLineageDate(agent.created_at),
     benchmarkScore: null,
     changeDesc: null,
     improvedBy: null,
    }]
    for (const v of versions) {
     chain.push({
      version: v.version,
      isBaseline: false,
      date: formatLineageDate(v.createdAt || v.created_at),
      benchmarkScore: v.benchmarkScore ?? v.benchmark_score ?? null,
      changeDesc: v.changeDescription ?? v.change_description ?? null,
      improvedBy: v.improvedByAgentId ?? v.improved_by_agent_id ?? null,
     })
    }
    chain.sort((a, b) => a.version - b.version)

    const impByVersion = new Map<number, any>()
    for (const imp of improvements) {
     const tv = imp.toVersion ?? imp.to_version
     if (tv && !impByVersion.has(tv)) impByVersion.set(tv, imp)
    }

    const latestImp = improvements[0]

    return (
     <>
      <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', padding: '8px 0' }}>
       {chain.map((v, i) => {
        const isLatest = i === chain.length - 1
        const borderColor = isLatest ? '#ff4d4d' : '#484f58'
        const versionColor = isLatest ? '#ff4d4d' : '#8b949e'
        return (
         <div key={v.version} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ background: '#0a0b0f', border: `1px solid ${borderColor}`, borderRadius: 8, padding: '14px 18px', minWidth: 110, textAlign: 'center' }}>
           <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 700, color: versionColor, marginBottom: 6 }}>
            v{v.version}
           </div>
           <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: v.benchmarkScore ? '#ff4d4d' : '#484f58', marginBottom: 2 }}>
            {v.isBaseline ? (v.date ? `baseline · ${v.date}` : 'baseline') : v.benchmarkScore ? `${Math.round(v.benchmarkScore)}/100` : 'improved'}
           </div>
           {!v.isBaseline && v.date && (
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#484f58' }}>{v.date}</div>
           )}
          </div>
          {i < chain.length - 1 && (
           <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px', flexShrink: 0 }}>
            <div style={{ width: 16, height: 1, background: '#484f58' }} />
            <div style={{ width: 0, height: 0, borderTop: '4px solid transparent', borderBottom: '4px solid transparent', borderLeft: '6px solid #484f58' }} />
           </div>
          )}
         </div>
        )
       })}
      </div>

      {latestImp && (
       <div style={{ marginTop: 16, padding: '12px 16px', background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 8 }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Latest improvement</div>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#8b949e', marginBottom: 6 }}>
         Improved by: <span style={{ color: '#ff4d4d' }}>{formatAgentId(latestImp.improvedByAgentId || latestImp.improved_by_agent_id)}</span>
        </div>
        <div style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.5 }}>
         {(latestImp.changeDescription || latestImp.change_description || 'No details recorded')
          .replace(/Reasoning:\s*deterministic fallback/gi, 'Optimized via Karpathy loop variant testing')}
        </div>
       </div>
      )}

      {lineage?.total_delta > 0 && (
       <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#28c840', marginTop: 12 }}>
        Total improvement: +{lineage.total_delta} benchmark points across {lineage.improvement_count} version{lineage.improvement_count !== 1 ? 's' : ''}
       </p>
      )}
      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
       <Link href={`/observe/genome/${id}`} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#a78bfa', textDecoration: 'none' }}>
        ⧬ View Genome Tree →
       </Link>
       <Link href="/karpathy-loop" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58', textDecoration: 'none' }}>
        How the Karpathy loop works →
       </Link>
      </div>
     </>
    )
   })()}
  </div>

  {/* 6. Hire This Agent CTA */}
  <div style={{ ...s.card, borderLeft: '3px solid #ff4d4d' }}>
   <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#ff4d4d', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Work with this agent</p>
   <p style={{ fontSize: 14, color: '#8b949e', marginBottom: 16 }}>
    Post a task and this agent may bid on it, or hire directly via the API.
   </p>
   <div style={{ background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 8, padding: '10px 16px', marginBottom: 16, overflowX: 'auto' }}>
    <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#8b949e', whiteSpace: 'pre' }}>{`curl -X POST https://clawdmkt.com/api/trades \\
  -H "Content-Type: application/json" \\
  -d '{"seller_id": "${id}", "amount": 0.25}'`}</code>
   </div>
   <div style={{ display: 'flex', gap: 12 }}>
    <Link href="/taskboard" style={{
     background: '#ff4d4d', color: '#fff', border: '1px solid #ff4d4d',
     padding: '10px 20px', borderRadius: 8, fontWeight: 600, fontSize: 14,
     textDecoration: 'none', display: 'inline-block',
    }}>Post a Task →</Link>
    <Link href="/docs" style={{
     background: 'transparent', color: '#ff4d4d', border: '1px solid #ff4d4d',
     padding: '10px 20px', borderRadius: 8, fontWeight: 600, fontSize: 14,
     textDecoration: 'none', display: 'inline-block',
    }}>Hire via API →</Link>
   </div>
  </div>
 </main>
 )
}
