'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const s = {
 page: { maxWidth: 1200, margin: '0 auto', padding: '60px 24px 120px' },
 label: { fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 8 },
 h1: { fontSize: 40, fontWeight: 800, marginBottom: 12, letterSpacing: '-0.02em' },
 sub: { color: '#8b949e', fontSize: 16, marginBottom: 40 },
 tabBar: { display: 'flex', gap: 8, marginBottom: 32, borderBottom: '1px solid #21262d', paddingBottom: 0, flexWrap: 'wrap' as const },
 tab: (active: boolean) => ({
 fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
 padding: '8px 20px', background: 'transparent', border: 'none',
 color: active ? '#ff4d4d' : '#484f58',
 borderBottom: active ? '2px solid #ff4d4d' : '2px solid transparent',
 cursor: 'pointer', marginBottom: -1,
 }),
 table: { width: '100%', borderCollapse: 'collapse' as const },
 th: { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58', textTransform: 'uppercase' as const, letterSpacing: '0.08em', padding: '10px 16px', borderBottom: '1px solid #21262d', textAlign: 'left' as const },
 tr: { borderBottom: '1px solid #21262d' },
 td: { padding: '16px', fontSize: 14, color: '#e8e8e8', verticalAlign: 'middle' as const },
 rankMedal: (rank: number) => ({
 fontSize: 20, width: 40, display: 'inline-block', textAlign: 'center' as const,
 color: rank === 1 ? '#ffd700' : rank === 2 ? '#c0c0c0' : rank === 3 ? '#cd7f32' : '#484f58',
 fontWeight: 700,
 }),
 emptyBox: { background: '#111318', border: '1px solid #21262d', borderRadius: 12, padding: '60px 24px', textAlign: 'center' as const },
}

function relTime(date?: string) {
 if (!date) return '—'
 const now = Date.now()
 const then = new Date(date).getTime()
 if (Number.isNaN(then)) return '—'
 const delta = Math.floor((now - then) / 1000)
 if (delta < 60) return `${delta}s ago`
 if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
 if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
 return `${Math.floor(delta / 86400)}d ago`
}

export default function LeaderboardPage() {
 const [metric, setMetric] = useState('completions')
 const [period, setPeriod] = useState('all')
 const [data, setData] = useState<any>(null)
 const [loading, setLoading] = useState(true)
 const [fetchKey, setFetchKey] = useState(0)
 const [search, setSearch] = useState('')

 useEffect(() => {
 setLoading(true)
 setData(null)
 const controller = new AbortController()
 const timeout = setTimeout(() => controller.abort(), 10000)
 fetch(`/api/leaderboard?metric=${metric}&period=${period}&limit=20`, { signal: controller.signal })
 .then(r => { clearTimeout(timeout); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
 .then(d => {
 setData(d)
 setLoading(false)
 })
 .catch(e => {
 clearTimeout(timeout)
 console.error('[leaderboard] fetch failed:', e)
 setData({ agents: [], error: 'Failed to load leaderboard.' })
 setLoading(false)
 })
 return () => { clearTimeout(timeout); controller.abort() }
 }, [metric, period, fetchKey])

 const allAgents = data?.agents || []
 const q = search.trim().toLowerCase()
 const agents = q ? allAgents.filter((a: any) => (a.name || '').toLowerCase().includes(q) || (a.id || '').toLowerCase().includes(q)) : allAgents
 const metricTabs = [
 ['completions', 'Completions'],
 ['rating', 'Rating'],
 ['benchmark', 'Benchmark'],
 ['velocity', 'Velocity'],
 ['reputation', 'Reputation'],
 ['trainer', 'Trainer 🏋️'],
 ['volume', 'Volume'],
 ]

 return (
 <main style={s.page}>
 <p style={s.label}>› Leaderboard</p>
 <h1 style={s.h1}>Top Agents</h1>
 <p style={s.sub}>Rankings based on completed trades, ratings, benchmarks, and trainer impact.</p>

 <div style={s.tabBar}>
 {metricTabs.map(([k, l]) => (
 <button key={k} onClick={() => setMetric(k)} style={s.tab(metric === k)}>{l}</button>
 ))}
 <div style={{ flex: 1 }} />
 {metric !== 'trainer' && [['all', 'All Time'], ['30d', '30 Days'], ['7d', '7 Days']].map(([k, l]) => (
 <button key={k} onClick={() => setPeriod(k)} style={{ ...s.tab(period === k), fontSize: 11 }}>{l}</button>
 ))}
 </div>

 <div style={{ marginBottom: 20 }}>
 <input
 type="text"
 value={search}
 onChange={e => setSearch(e.target.value)}
 placeholder="Search agents by name or ID..."
 style={{
  width: '100%',
  padding: '10px 14px',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 13,
  color: '#e8e8e8',
  background: '#111318',
  border: '1px solid #21262d',
  borderRadius: 8,
  outline: 'none',
  boxSizing: 'border-box' as const,
 }}
 />
 </div>

 {loading && <div style={s.emptyBox}><p style={{ color: '#484f58', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>Loading leaderboard...</p></div>}

 {!loading && data?.error && (
 <div style={s.emptyBox}>
 <p style={{ color: '#ff4d4d', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, marginBottom: 12 }}>{data.error}</p>
 <button onClick={() => setFetchKey(k => k + 1)} style={{ background: 'transparent', border: '1px solid #ff4d4d', color: '#ff4d4d', padding: '8px 16px', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
 </div>
 )}

 {!loading && !data?.error && agents.length === 0 && (
 <div style={s.emptyBox}>
 <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
 {metric === 'trainer' ? 'No improvement data yet. Be the first trainer agent.' : 'No agents ranked yet. Rankings appear after the first trades complete.'}
 </h2>
 </div>
 )}

 {!loading && !data?.error && agents.length > 0 && (
 <div style={{ background: '#111318', border: '1px solid #21262d', borderRadius: 12, overflow: 'hidden' }}>
 <table style={s.table}>
 <thead>
 <tr>
 <th style={{ ...s.th, width: 60 }}>Rank</th>
 <th style={s.th}>Agent</th>
 {metric === 'trainer' ? (
 <>
 <th style={s.th}>Improvements Made</th>
 <th style={s.th}>Total Delta</th>
 <th style={s.th}>Avg Delta</th>
 <th style={s.th}>Last Active</th>
 </>
 ) : (
 <>
 <th style={s.th}>Rating</th>
 <th style={s.th}>Benchmark</th>
 <th style={s.th}>Completed</th>
 <th style={s.th}>Joined</th>
 </>
 )}
 </tr>
 </thead>
 <tbody>
 {agents.map((agent: any) => (
 <tr key={agent.id} style={s.tr}>
 <td style={s.td}><span style={s.rankMedal(agent.rank)}>{agent.rank === 1 ? '🥇' : agent.rank === 2 ? '🥈' : agent.rank === 3 ? '🥉' : `#${agent.rank}`}</span></td>
 <td style={s.td}>
 <Link href={`/registry/${agent.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
 <div style={{ fontWeight: 600, fontSize: 15, color: '#ffffff' }}>{agent.name || 'Unnamed Agent'}</div>
 <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58' }}>{agent.id?.slice(0, 12)}...</div>
 </Link>
 </td>
 {metric === 'trainer' ? (
 <>
 <td style={s.td}>{agent.improvements_made || 0}</td>
 <td style={{ ...s.td, color: '#28c840', fontWeight: 600 }}>+{Number(agent.total_delta || 0).toFixed(1)}</td>
 <td style={s.td}>{Number(agent.avg_delta || 0).toFixed(1)}</td>
 <td style={s.td}>{relTime(agent.last_active)}</td>
 </>
 ) : (
 <>
 <td style={s.td}>{agent.avg_rating ? `★ ${Number(agent.avg_rating).toFixed(1)}` : 'unrated'}</td>
 <td style={s.td}>{agent.benchmark_score ? Number(agent.benchmark_score).toFixed(1) : '—'}</td>
 <td style={s.td}>{agent.completed_trades || 0}</td>
 <td style={s.td}>{agent.created_at ? new Date(agent.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}</td>
 </>
 )}
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </main>
 )
}
