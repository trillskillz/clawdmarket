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
 badge: { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#8b949e', background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 20, padding: '2px 10px', marginRight: 4, display: 'inline-block', marginBottom: 4 },
 metaItem: { fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#484f58', marginRight: 20 },
 btn: (variant: 'primary' | 'outline') => ({
 background: variant === 'primary' ? '#ff4d4d' : 'transparent',
 color: variant === 'primary' ? '#fff' : '#ff4d4d',
 border: '1px solid #ff4d4d',
 padding: '10px 24px', borderRadius: 8,
 fontWeight: 600, fontSize: 14,
 cursor: 'pointer' as const,
 textDecoration: 'none',
 display: 'inline-block',
 marginRight: 12,
 }),
 statBox: { background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 8, padding: '16px 20px', flex: 1, minWidth: 120 },
 sectionTitle: { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 12 },
}

export default function AgentDetailPage() {
 const params = useParams()
 const id = params?.id as string
 const [agent, setAgent] = useState<any>(null)
 const [loading, setLoading] = useState(true)
 const [error, setError] = useState<string | null>(null)

 useEffect(() => {
 if (!id) return
 fetch(`/api/agents/${id}`)
 .then(r => {
 if (r.status === 404) throw new Error('not_found')
 return r.json()
 })
 .then(d => {
 if (d.error) throw new Error(d.error)
 setAgent(d)
 setLoading(false)
 })
 .catch(err => {
 setError(err.message)
 setLoading(false)
 })
 }, [id])

 if (loading) {
 return (
 <main style={s.page}>
 <p style={s.label}>› Agent Profile</p>
 <h1 style={s.h1}>Agent Profile</h1>
 <p style={{ color: '#484f58', fontFamily: 'JetBrains Mono, monospace' }}>
 Loading agent...
 </p>
 </main>
 )
 }

 if (error || !agent) {
 return (
 <main style={s.page}>
 <p style={s.label}>› Registry</p>
 <h1 style={s.h1}>Agent Not Found</h1>
 <p style={s.sub}>This agent may have been deregistered or the ID is invalid.</p>
 <Link href="/registry" style={s.btn('primary')}>← Back to Registry</Link>
 </main>
 )
 }

 return (
 <main style={s.page}>

 {/* BREADCRUMB */}
 <Link href="/registry" style={{
 fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
 color: '#484f58', textDecoration: 'none', marginBottom: 24,
 display: 'inline-block',
 }}>
 ← Registry
 </Link>

 {/* HEADER */}
 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 8 }}>
 <div>
 <p style={s.label}>› Agent Profile</p>
 <h1 style={s.h1}>{agent.name}</h1>
 </div>
 <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
 <span style={{
 fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
 color: '#28c840', background: '#28c84011',
 border: '1px solid #28c84033', borderRadius: 20, padding: '4px 14px',
 }}>
 v{agent.version || 1}
 </span>
 <span style={{
 fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
 color: agent.status === 'active' ? '#28c840' : '#484f58',
 background: agent.status === 'active' ? '#28c84011' : '#48485811',
 border: `1px solid ${agent.status === 'active' ? '#28c84033' : '#48485833'}`,
 borderRadius: 20, padding: '4px 14px',
 }}>
 {agent.status}
 </span>
 </div>
 </div>

 {agent.description && (
 <p style={s.sub}>{agent.description}</p>
 )}

 {/* STATS ROW */}
 <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
 {[
 { label: 'Rating', value: agent.avg_rating ? `★ ${Number(agent.avg_rating).toFixed(1)}` : 'Unrated' },
 { label: 'Benchmark', value: agent.benchmark_score ? `${Number(agent.benchmark_score).toFixed(0)}/100` : '—' },
 { label: 'Velocity', value: agent.velocity_score ? (agent.velocity_score >= 0 ? `+${agent.velocity_score}` : agent.velocity_score) : '—' },
 { label: 'Improvements', value: agent.improvement_count || 0 },
 ].map(stat => (
 <div key={stat.label} style={s.statBox}>
 <div style={{ fontSize: 20, fontWeight: 700, color: '#ff4d4d', marginBottom: 4 }}>
 {stat.value}
 </div>
 <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
 {stat.label}
 </div>
 </div>
 ))}
 </div>

 {/* CAPABILITIES */}
 <div style={s.card}>
 <p style={s.sectionTitle}>Capabilities</p>
 <div>
 {(agent.capabilities || []).length > 0
 ? agent.capabilities.map((cap: string) => (
 <span key={cap} style={s.badge}>{cap}</span>
 ))
 : <span style={{ color: '#484f58', fontSize: 14 }}>No capabilities listed</span>
 }
 </div>
 </div>

 {/* IDENTITY */}
 <div style={s.card}>
 <p style={s.sectionTitle}>Identity</p>
 <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
 <span style={s.metaItem}>ID: {agent.id}</span>
 {agent.owner_address && (
 <span style={s.metaItem}>
 Owner: {agent.owner_address.slice(0, 8)}...{agent.owner_address.slice(-6)}
 </span>
 )}
 {agent.model_id && (
 <span style={s.metaItem}>Model: {agent.model_id}</span>
 )}
 {agent.created_at && (
 <span style={s.metaItem}>
 Joined: {new Date(agent.created_at).toLocaleDateString()}
 </span>
 )}
 </div>
 </div>

 {/* HIRE + MESSAGE BUTTONS -- redirect to docs */}
 <div style={{ marginTop: 24 }}>
 <a href="/docs" style={s.btn('primary')}>Hire via API →</a>
 <a href="/docs" style={s.btn('outline')}>Message via API →</a>
 </div>

 {/* FOOTER */}
 <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid #21262d' }}>
 <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#484f58' }}>
 Agents interact via API · POST /api/trades · MPP $0.01 ·{' '}
 <Link href="/docs" style={{ color: '#ff4d4d' }}>Read the docs →</Link>
 </p>
 </div>

 </main>
 )
}
