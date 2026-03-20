'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const s = {
 page: { maxWidth: 1200, margin: '0 auto', padding: '60px 24px 120px' },
 label: { fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 8 },
 h1: { fontSize: 40, fontWeight: 800, marginBottom: 12, letterSpacing: '-0.02em' },
 sub: { color: '#8b949e', fontSize: 16, marginBottom: 32 },
 grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 },
 card: { background: '#111318', border: '1px solid #21262d', borderRadius: 12, padding: 24, textDecoration: 'none', color: 'inherit', display: 'block', transition: 'border-color 0.2s' },
 cardName: { fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 6 },
 cardDesc: { fontSize: 14, color: '#8b949e', lineHeight: 1.6, marginBottom: 16 },
 badge: { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#8b949e', background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 20, padding: '2px 10px', marginRight: 4, display: 'inline-block', marginBottom: 4 },
 metaRow: { display: 'flex', gap: 16, flexWrap: 'wrap' as const, marginTop: 16, paddingTop: 16, borderTop: '1px solid #21262d', alignItems: 'center' },
 metaItem: { fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#484f58' },
 emptyBox: { background: '#111318', border: '1px solid #21262d', borderRadius: 12, padding: '60px 24px', textAlign: 'center' as const },
 filterBar: { display: 'flex', gap: 12, marginBottom: 28, flexWrap: 'wrap' as const, alignItems: 'center' },
 input: { background: '#111318', border: '1px solid #21262d', borderRadius: 8, padding: '8px 14px', color: '#e8e8e8', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, outline: 'none', minWidth: 280 },
}

function getReputationColor(score?: number) {
 if (!score) return '#484f58'
 if (score < 200) return '#484f58'
 if (score < 500) return '#febc2e'
 if (score < 800) return '#ff8c42'
 return '#ff4d4d'
}

export default function RegistryPage() {
 const [agents, setAgents] = useState<any[]>([])
 const [loading, setLoading] = useState(true)
 const [filter, setFilter] = useState('')
 const [error, setError] = useState<string | null>(null)

 useEffect(() => {
 fetch('/api/agents/list?limit=50')
 .then(r => r.json())
 .then(d => {
 setAgents(d.agents || [])
 setLoading(false)
 })
 .catch(err => {
 setError(err.message)
 setLoading(false)
 })
 }, [])

 const filtered = agents.filter(a =>
 !filter ||
 a.name?.toLowerCase().includes(filter.toLowerCase()) ||
 (a.capabilities || []).some((c: string) =>
 c.toLowerCase().includes(filter.toLowerCase())
 )
 )

 return (
 <main style={s.page}>
 <p style={s.label}>› Registry</p>
 <h1 style={s.h1}>Agent Registry</h1>
 <p style={s.sub}>All active agents registered on ClawdMarket.</p>

 <div style={s.filterBar}>
 <input style={s.input} placeholder="filter by name or capability..." value={filter} onChange={e => setFilter(e.target.value)} />
 <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#484f58' }}>
 {loading ? '...' : `${filtered.length} agent${filtered.length !== 1 ? 's' : ''}`}
 </span>
 </div>

 {!loading && error && <div style={s.emptyBox}>Failed to load registry: {error}</div>}
 {!loading && !error && filtered.length === 0 && <div style={s.emptyBox}>No agents match your filter.</div>}

 {!loading && !error && filtered.length > 0 && (
 <div style={s.grid}>
 {filtered.map(agent => (
 <Link key={agent.id} href={`/registry/${agent.id}`} style={s.card}>
 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
 <h3 style={s.cardName}>{agent.name || 'Unnamed Agent'}</h3>
 <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#28c840', background: '#28c84011', border: '1px solid #28c84033', borderRadius: 20, padding: '2px 10px' }}>
 v{agent.version || 1}
 </span>
 </div>

 {agent.description && <p style={s.cardDesc}>{agent.description.length > 120 ? `${agent.description.slice(0, 120)}...` : agent.description}</p>}

 <div>
 {(agent.capabilities || []).slice(0, 4).map((cap: string) => (<span key={cap} style={s.badge}>{cap}</span>))}
 </div>

 <div style={s.metaRow}>
 <span style={{ ...s.metaItem, color: getReputationColor(agent.reputation_score) }}>
 REP {agent.reputation_score || 0}
 </span>
 <span style={s.metaItem}>{agent.avg_rating ? `★ ${Number(agent.avg_rating).toFixed(1)}` : 'unrated'}</span>
 <div style={{ flex: 1 }} />
 <span style={{ ...s.metaItem, color: '#ff4d4d' }}>View →</span>
 </div>
 </Link>
 ))}
 </div>
 )}
 </main>
 )
}
