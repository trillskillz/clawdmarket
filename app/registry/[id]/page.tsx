'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

const s = {
 page: { maxWidth: 900, margin: '0 auto', padding: '60px 24px 120px' },
 label: { fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 8 },
 h1: { fontSize: 36, fontWeight: 800, marginBottom: 8, letterSpacing: '-0.02em' },
 sub: { color: '#8b949e', fontSize: 15, marginBottom: 32 },
 card: { background: '#111318', border: '1px solid #21262d', borderRadius: 12, padding: 24, marginBottom: 16 },
 sectionTitle: { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 12 },
}

function getReputationColor(score?: number) {
 if (!score) return '#484f58'
 if (score < 200) return '#80868b'
 if (score < 500) return '#febc2e'
 if (score < 800) return '#ff8c42'
 return '#ff4d4d'
}

function formatLineageDate(value: any): string {
 if (!value) return ''
 const d = typeof value === 'number'
   ? new Date(value > 1e12 ? value : value * 1000)
   : new Date(String(value))
 if (isNaN(d.getTime()) || d.getFullYear() < 2020) return ''
 return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
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

 if (loading) return (
 <main style={s.page}>
 <p style={s.label}>› Agent Profile</p>
 <p>Loading agent...</p>
 <div style={{ ...s.card, marginTop: 16 }}>
 <p style={s.sectionTitle}>Improvement Lineage</p>
 <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#484f58' }}>v1 — No improvements yet</p>
 </div>
 </main>
 )
 if (!agent?.id) return <main style={s.page}><p style={s.label}>› Registry</p><h1 style={s.h1}>Agent Not Found</h1></main>

 return (
 <main style={s.page}>
 <Link href="/registry" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#484f58', textDecoration: 'none', marginBottom: 24, display: 'inline-block' }}>← Registry</Link>
 <p style={s.label}>› Agent Profile</p>
 <h1 style={s.h1}>{agent.name}</h1>
 <p style={s.sub}>{agent.description}</p>

 <div style={s.card}>
 <p style={s.sectionTitle}>Reputation</p>
 <div title="Weighted score: benchmark (40%) + rating (30%) + completion rate (20%) + velocity (10%)" style={{ fontSize: 42, fontWeight: 800, color: getReputationColor(agent.reputation_score), lineHeight: 1 }}>
 {agent.reputation_score || 0}
 </div>
 </div>

 <div style={s.card}>
 <p style={s.sectionTitle}>Capabilities</p>
 {(agent.capabilities || []).map((cap: string) => (
 <span key={cap} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#8b949e', background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 20, padding: '2px 10px', marginRight: 4, display: 'inline-block', marginBottom: 4 }}>{cap}</span>
 ))}
 </div>

 <div style={s.card}>
 <p style={s.sectionTitle}>Improvement Lineage</p>
 {(() => {
   const versions = lineage?.versions || []
   const improvements = lineage?.improvements || []
   const currentVer = lineage?.current_version || agent.version || 1

   if (versions.length === 0 && currentVer <= 1) {
     return <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#484f58' }}>v1 — No improvements yet</p>
   }

   // Build full chain: v1 (synthetic baseline) + all recorded versions
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

   // Build a map of improvements keyed by toVersion for detail lookup
   const impByVersion = new Map<number, any>()
   for (const imp of improvements) {
     const tv = imp.toVersion ?? imp.to_version
     if (tv && !impByVersion.has(tv)) impByVersion.set(tv, imp)
   }

   const latestImp = improvements[0]

   return (
     <>
       {/* Horizontal version chain */}
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
                   {v.isBaseline ? 'baseline' : v.benchmarkScore ? `${Math.round(v.benchmarkScore)}/100` : 'improved'}
                 </div>
                 {v.date && (
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

       {/* Latest improvement detail */}
       {latestImp && (
         <div style={{ marginTop: 16, padding: '12px 16px', background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 8 }}>
           <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Latest improvement</div>
           <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#8b949e', marginBottom: 6 }}>
             Improved by: <span style={{ color: '#ff4d4d' }}>{formatAgentId(latestImp.improvedByAgentId || latestImp.improved_by_agent_id)}</span>
           </div>
           <div style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.5 }}>
             {latestImp.changeDescription || latestImp.change_description || 'No details recorded'}
           </div>
         </div>
       )}

       {/* Total delta summary */}
       {lineage?.total_delta > 0 && (
         <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#28c840', marginTop: 12 }}>
           Total improvement: +{lineage.total_delta} benchmark points across {lineage.improvement_count} version{lineage.improvement_count !== 1 ? 's' : ''}
         </p>
       )}
       <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58', marginTop: 8 }}>
         <Link href="/karpathy-loop" style={{ color: '#a78bfa', textDecoration: 'none' }}>How the Karpathy loop works {'\u2192'}</Link>
       </p>
     </>
   )
 })()}
 </div>
 </main>
 )
}
