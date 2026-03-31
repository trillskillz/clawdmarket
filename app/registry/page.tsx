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
 const [lookupDomain, setLookupDomain] = useState('')
 const [lookupResult, setLookupResult] = useState<any>(null)
 const [lookupLoading, setLookupLoading] = useState(false)
 const [lookupError, setLookupError] = useState<string | null>(null)

 useEffect(() => {
 let retryTimer: ReturnType<typeof setTimeout>

 async function fetchAgents() {
 setLoading(true)
 setError(null)
 const controller = new AbortController()
 const timeout = setTimeout(() => controller.abort(), 10000)
 try {
 const r = await fetch('/api/agents/list?limit=50', { cache: 'no-store', signal: controller.signal })
 clearTimeout(timeout)
 if (!r.ok) throw new Error(`HTTP ${r.status}`)
 const d = await r.json()
 setAgents(d.agents || [])
 setLoading(false)
 } catch (err: any) {
 clearTimeout(timeout)
 const msg = err?.name === 'AbortError' ? 'Request timed out after 10s' : err.message
 console.error('[/registry] fetch failed:', msg)
 setError('Failed to load registry. Retrying in 5s...')
 setLoading(false)
 retryTimer = setTimeout(fetchAgents, 5000)
 }
 }

 fetchAgents()
 return () => clearTimeout(retryTimer)
 }, [])

 const filtered = agents.filter(a =>
 !filter ||
 a.name?.toLowerCase().includes(filter.toLowerCase()) ||
 (a.capabilities || []).some((c: string) =>
 c.toLowerCase().includes(filter.toLowerCase())
 )
 )

 const handleLookup = async () => {
 if (!lookupDomain.trim()) return
 setLookupLoading(true)
 setLookupError(null)
 setLookupResult(null)
 try {
 const domain = lookupDomain.trim().replace(/^https?:\/\//, '')
 const res = await fetch(`/api/agents/lookup?domain=${encodeURIComponent(domain)}`)
 const data = await res.json()
 if (data.name || data.capabilities) {
 setLookupResult(data)
 } else {
 setLookupError('No agent.json found at this domain')
 }
 } catch (e: any) {
 setLookupError(e.message)
 } finally {
 setLookupLoading(false)
 }
 }

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

 <div style={{
 background: '#111318',
 border: '1px solid #21262d',
 borderRadius: 12,
 padding: 24,
 marginBottom: 32,
 }}>
 <p style={{
 fontFamily: 'JetBrains Mono, monospace',
 fontSize: 11,
 color: '#484f58',
 textTransform: 'uppercase',
 letterSpacing: '0.1em',
 marginBottom: 12,
 }}>
 › Lookup Agent by Domain
 </p>
 <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
 <input
 style={{
 flex: 1,
 background: '#0d1117',
 border: '1px solid #21262d',
 borderRadius: 8,
 padding: '10px 14px',
 color: '#e8e8e8',
 fontFamily: 'JetBrains Mono, monospace',
 fontSize: 13,
 outline: 'none',
 }}
 placeholder="example.com"
 value={lookupDomain}
 onChange={e => setLookupDomain(e.target.value)}
 onKeyDown={e => e.key === 'Enter' && handleLookup()}
 />
 <button
 onClick={handleLookup}
 disabled={lookupLoading}
 style={{
 background: '#ff4d4d',
 color: '#fff',
 border: 'none',
 borderRadius: 8,
 padding: '10px 20px',
 fontWeight: 600,
 fontSize: 14,
 cursor: lookupLoading ? 'wait' : 'pointer',
 fontFamily: 'inherit',
 opacity: lookupLoading ? 0.7 : 1,
 }}
 >
 {lookupLoading ? 'Looking up...' : 'Lookup →'}
 </button>
 </div>

 {lookupError && (
 <p style={{
 fontFamily: 'JetBrains Mono, monospace',
 fontSize: 12,
 color: '#ff4d4d',
 margin: 0,
 }}>
 ✗ {lookupError}
 </p>
 )}

 {lookupResult && (
 <div style={{
 background: '#0d1117',
 border: '1px solid #28c84033',
 borderRadius: 8,
 padding: 16,
 marginTop: 8,
 }}>
 <div style={{
 display: 'flex',
 justifyContent: 'space-between',
 marginBottom: 8,
 }}>
 <span style={{ fontWeight: 700, fontSize: 16 }}>
 {lookupResult.name || 'Unknown Agent'}
 </span>
 <span style={{
 fontFamily: 'JetBrains Mono, monospace',
 fontSize: 11,
 color: '#28c840',
 background: '#28c84011',
 border: '1px solid #28c84033',
 borderRadius: 20,
 padding: '2px 10px',
 }}>
 agent.json found ✓
 </span>
 </div>
 {lookupResult.description && (
 <p style={{ fontSize: 13, color: '#8b949e', marginBottom: 8, lineHeight: 1.6 }}>
 {lookupResult.description}
 </p>
 )}
 {lookupResult.capabilities?.length > 0 && (
 <div style={{ marginBottom: 8 }}>
 {lookupResult.capabilities.slice(0, 5).map((c: string) => (
 <span key={c} style={{
 fontFamily: 'JetBrains Mono, monospace',
 fontSize: 11,
 color: '#8b949e',
 background: '#0a0b0f',
 border: '1px solid #21262d',
 borderRadius: 20,
 padding: '2px 10px',
 marginRight: 4,
 display: 'inline-block',
 marginBottom: 4,
 }}>
 {c}
 </span>
 ))}
 </div>
 )}
 {lookupResult.endpoint && (
 <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#484f58', margin: 0 }}>
 endpoint: {lookupResult.endpoint}
 </p>
 )}
 <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58', marginTop: 8, marginBottom: 0 }}>
 Add agent.json to your domain:{' '}
 <a href="/docs" style={{ color: '#ff4d4d' }}>
 see docs →
 </a>
 </p>
 </div>
 )}
 </div>

 {!loading && error && (
 <div style={s.emptyBox}>
 <p style={{ color: '#ff4d4d', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, marginBottom: 8 }}>{error}</p>
 <p style={{ color: '#484f58', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>Check connection — retrying automatically every 5s</p>
 </div>
 )}
 {!loading && !error && agents.length === 0 && (
 <div style={s.emptyBox}>
 <p style={{ fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 8 }}>No agents registered yet. Be the first.</p>
 <p style={{ color: '#8b949e', fontSize: 14 }}>
 <Link href="/docs" style={{ color: '#ff4d4d' }}>Read the Docs →</Link>
 </p>
 </div>
 )}
 {!loading && !error && agents.length > 0 && filtered.length === 0 && (
 <div style={s.emptyBox}>No agents match your filter.</div>
 )}

 {!loading && !error && agents.length > 0 && filtered.length > 0 && (
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
