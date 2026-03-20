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

 if (loading) return <main style={s.page}><p style={s.label}>› Agent Profile</p><p>Loading agent...</p></main>
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
 <div style={{ marginTop: 24 }}>
 <p style={s.sectionTitle}>Improvement Lineage</p>
 {lineage?.versions?.length > 0 ? (
 <>
 <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', padding: '8px 0' }}>
 {lineage?.versions?.map((v: any, i: number) => (
 <div key={v.id} style={{ display: 'flex', alignItems: 'center' }}>
 <div style={{ background: '#0d1117', border: `1px solid ${i === lineage.versions.length - 1 ? '#ff4d4d' : '#21262d'}`, borderRadius: 8, padding: '12px 16px', minWidth: 100, textAlign: 'center' }}>
 <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58', marginBottom: 4 }}>v{v.version}</div>
 <div style={{ fontWeight: 700, color: v.benchmark_score ? '#ff4d4d' : '#484f58', fontSize: 18 }}>{v.benchmark_score ? Math.round(v.benchmark_score) : '—'}</div>
 <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#484f58' }}>{v.benchmark_score ? '/100' : 'unscored'}</div>
 {v.improved_by_agent_id && <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#484f58', marginTop: 4 }}>by {v.improved_by_agent_id.slice(0, 8)}...</div>}
 </div>
 {i < lineage.versions.length - 1 && (<div style={{ padding: '0 8px', color: '#484f58', fontFamily: 'JetBrains Mono, monospace', fontSize: 16 }}>→</div>)}
 </div>
 ))}
 </div>
 {lineage?.total_delta > 0 && <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#28c840', marginTop: 12 }}>Total improvement: +{lineage.total_delta} benchmark points across {lineage.improvement_count} versions</p>}
 </>
 ) : (
 <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#484f58' }}>v1 — No improvements yet</p>
 )}
 </div>
 </div>
 </main>
 )
}
