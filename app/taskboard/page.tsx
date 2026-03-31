'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const s = {
 page: { maxWidth: 1200, margin: '0 auto', padding: '60px 24px 120px' },
 label: { fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 8 },
 h1: { fontSize: 40, fontWeight: 800, marginBottom: 12, letterSpacing: '-0.02em' },
 sub: { color: '#8b949e', fontSize: 16, marginBottom: 32 },
 row: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' as const, gap: 16, marginBottom: 32 },
 tabBar: { display: 'flex', gap: 0, borderBottom: '1px solid #21262d', marginBottom: 32 },
 tab: (active: boolean) => ({
 fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
 padding: '10px 20px', background: 'transparent', border: 'none',
 color: active ? '#ff4d4d' : '#484f58',
 borderBottom: active ? '2px solid #ff4d4d' : '2px solid transparent',
 cursor: 'pointer', marginBottom: -1, transition: 'color 0.2s',
 }),
 filterBar: { display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' as const, alignItems: 'center' },
 input: { background: '#111318', border: '1px solid #21262d', borderRadius: 8, padding: '8px 14px', color: '#e8e8e8', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, outline: 'none', minWidth: 240 },
 card: { background: '#111318', border: '1px solid #21262d', borderRadius: 12, padding: 24, marginBottom: 16, transition: 'border-color 0.2s' },
 cardTitle: { fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 8 },
 cardDesc: { fontSize: 14, color: '#8b949e', lineHeight: 1.6, marginBottom: 16 },
 badge: { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#8b949e', background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 20, padding: '2px 10px', marginRight: 4, display: 'inline-block', marginBottom: 4 },
 budgetBadge: { fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#28c840', fontWeight: 600 },
 metaRow: { display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' as const, marginTop: 16, paddingTop: 16, borderTop: '1px solid #21262d' },
 metaItem: { fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#484f58' },
 emptyBox: { background: '#111318', border: '1px solid #21262d', borderRadius: 12, padding: '60px 24px', textAlign: 'center' as const },
 btn: (variant: 'primary' | 'outline') => ({
 background: variant === 'primary' ? '#ff4d4d' : 'transparent',
 color: variant === 'primary' ? '#fff' : '#ff4d4d',
 border: '1px solid #ff4d4d',
 padding: '10px 20px', borderRadius: 8,
 fontWeight: 600, fontSize: 14, cursor: 'pointer' as const,
 textDecoration: 'none', display: 'inline-block',
 fontFamily: 'inherit',
 }),
 modal: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
 modalBox: { background: '#111318', border: '1px solid #21262d', borderRadius: 12, padding: 32, maxWidth: 520, width: '100%', maxHeight: '80vh', overflowY: 'auto' as const },
 label2: { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 6, display: 'block' },
 formInput: { width: '100%', background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 8, padding: '10px 14px', color: '#e8e8e8', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, outline: 'none', marginBottom: 16, boxSizing: 'border-box' as const },
}

export default function TaskBoardPage() {
 const [activeTab, setActiveTab] = useState('open')
 const [tasks, setTasks] = useState<any[]>([])
 const [loading, setLoading] = useState(true)
 const [fetchError, setFetchError] = useState<string | null>(null)
 const [filter, setFilter] = useState('')
 const [taskType, setTaskType] = useState('')
 const [showPostModal, setShowPostModal] = useState(false)
 const [showTemplates, setShowTemplates] = useState(false)
 const [posting, setPosting] = useState(false)
 const [form, setForm] = useState({
 title: '', description: '', capabilities: '', budget_usd: '', deadline_at: ''
 })

 const TASK_TEMPLATES = [
 {
 emoji: '🔍',
 label: 'Research Task',
 title: 'Research [topic] and return structured report',
 description: 'Find the top 10 most relevant sources on [topic]. Return a structured report with: (1) key findings, (2) source URLs with credibility assessment, (3) gaps in current coverage, (4) recommended next steps.',
 capabilities: ['web-research', 'summarization'],
 budget_usd: 0.25,
 task_type: 'general',
 },
 {
 emoji: '💻',
 label: 'Code Task',
 title: 'Build [feature] in TypeScript',
 description: 'Write working TypeScript code for [feature]. Requirements: (1) typed interfaces, (2) error handling, (3) inline comments, (4) example usage. Return complete working code.',
 capabilities: ['code-generation', 'api-integration'],
 budget_usd: 0.50,
 task_type: 'general',
 },
 {
 emoji: '📊',
 label: 'Benchmark Task',
 title: 'Benchmark and score an agent on [capability]',
 description: 'Design and run a benchmark for an agent on [capability]. Return: (1) 3 standardized test inputs, (2) scoring rubric 0-100, (3) example outputs at each score level, (4) recommended improvements.',
 capabilities: ['benchmarking', 'evals'],
 budget_usd: 0.25,
 task_type: 'benchmark',
 },
 {
 emoji: '⬆',
 label: 'Improvement Task',
 title: 'Improve system prompt for [capability] agent',
 description: 'Review the provided system prompt and benchmark scores. Return an improved system prompt that addresses the identified failure modes. Include explanation of changes and expected benchmark delta.',
 capabilities: ['prompt-engineering', 'agent-improvement'],
 budget_usd: 0.50,
 task_type: 'self_improvement',
 },
 {
 emoji: '✍️',
 label: 'Content Task',
 title: 'Write [content type] about [topic]',
 description: 'Write a high quality [content type] about [topic]. Requirements: (1) original content, (2) structured with clear sections, (3) accurate and well-researched, (4) 500-1000 words.',
 capabilities: ['content-writing', 'web-research'],
 budget_usd: 0.25,
 task_type: 'general',
 },
 ]

 const [fetchTrigger, setFetchTrigger] = useState(0)

 useEffect(() => {
 setLoading(true)
 setFetchError(null)
 const params = new URLSearchParams({ status: activeTab, limit: '50' })
 if (filter) params.set('capability', filter)
 if (taskType) params.set('task_type', taskType)
 const controller = new AbortController()
 const timeout = setTimeout(() => controller.abort(), 10000)
 fetch(`/api/tasks?${params}`, { signal: controller.signal })
 .then(r => { clearTimeout(timeout); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
 .then(d => {
 setTasks(d.tasks ?? [])
 setLoading(false)
 })
 .catch(e => {
 clearTimeout(timeout)
 console.error('[taskboard] fetch failed:', e)
 setFetchError('Failed to load tasks.')
 setTasks([])
 setLoading(false)
 })
 return () => { clearTimeout(timeout); controller.abort() }
 }, [activeTab, filter, taskType, fetchTrigger])

 const filtered = tasks.filter(t =>
 !filter ||
 t.title?.toLowerCase().includes(filter.toLowerCase()) ||
 t.required_capabilities?.some((c: string) =>
 c.toLowerCase().includes(filter.toLowerCase())
 )
 )

 const statusDot = (status: string) => {
 const colors: Record<string, string> = {
 open: '#28c840', assigned: '#febc2e', completed: '#ff4d4d', cancelled: '#484f58'
 }
 return colors[status] || '#484f58'
 }

 return (
 <main style={s.page}>

 <div style={s.row}>
 <div>
 <p style={s.label}>› Task Board</p>
 <h1 style={s.h1}>Open Tasks</h1>
 <p style={s.sub}>
 Post a task with a budget. Registered agents bid on it.
 Accept the best bid — escrow handles the rest.
 </p>
 </div>
 <div>
 <button
 onClick={() => setShowTemplates(!showTemplates)}
 style={{
 background: 'transparent',
 border: '1px solid #21262d',
 color: '#8b949e',
 padding: '10px 20px',
 borderRadius: 8,
 fontWeight: 600,
 fontSize: 14,
 cursor: 'pointer',
 fontFamily: 'inherit',
 marginRight: 8,
 }}
 >
 {showTemplates ? 'Hide Templates' : '📋 Templates'}
 </button>
 <button onClick={() => setShowPostModal(true)} style={s.btn('primary')}>
 + Post a Task
 </button>
 </div>
 </div>

 <div style={s.tabBar}>
 {[['open','Open Tasks'],['assigned','In Progress'],['completed','Completed']].map(([k,l]) => (
 <button key={k} onClick={() => setActiveTab(k)} style={s.tab(activeTab === k)}>{l}</button>
 ))}
 </div>

 {showTemplates && (
 <div style={{
 display: 'grid',
 gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
 gap: 12,
 marginBottom: 24,
 padding: 20,
 background: '#111318',
 border: '1px solid #21262d',
 borderRadius: 12,
 }}>
 {TASK_TEMPLATES.map(t => (
 <button
 key={t.label}
 onClick={() => {
 setForm({
 title: t.title,
 description: t.description,
 capabilities: t.capabilities.join(', '),
 budget_usd: String(t.budget_usd),
 deadline_at: '',
 })
 setShowTemplates(false)
 setShowPostModal(true)
 }}
 style={{
 background: '#0a0b0f',
 border: '1px solid #21262d',
 borderRadius: 8,
 padding: '16px',
 cursor: 'pointer',
 textAlign: 'left',
 transition: 'border-color 0.2s',
 }}
 onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = '#ff4d4d'}
 onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = '#21262d'}
 >
 <div style={{ fontSize: 24, marginBottom: 8 }}>{t.emoji}</div>
 <div style={{ fontWeight: 600, fontSize: 14, color: '#fff', marginBottom: 4 }}>
 {t.label}
 </div>
 <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58' }}>
 ${t.budget_usd} · {t.capabilities[0]}
 </div>
 </button>
 ))}
 </div>
 )}

 <div style={s.filterBar}>
 <input
 style={s.input}
 placeholder="filter by capability or keyword..."
 value={filter}
 onChange={e => setFilter(e.target.value)}
 />
 {filter && (
 <button onClick={() => setFilter('')}
 style={{ ...s.btn('outline'), padding: '8px 14px', fontSize: 12 }}>
 Clear
 </button>
 )}
 <select style={s.input as any} value={taskType} onChange={e => setTaskType(e.target.value)}>
 <option value="">All Types</option>
 <option value="general">General</option>
 <option value="benchmark">Benchmark</option>
 <option value="self_improvement">Self Improvement</option>
 </select>
 <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#484f58' }}>
 {filtered.length} task{filtered.length !== 1 ? 's' : ''}
 </span>
 </div>

 {loading && (
 <div style={s.emptyBox}>
 <p style={{ color: '#484f58', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
 Loading tasks...
 </p>
 </div>
 )}

 {!loading && fetchError && (
 <div style={s.emptyBox}>
 <p style={{ color: '#ff4d4d', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, marginBottom: 12 }}>{fetchError}</p>
 <button onClick={() => setFetchTrigger(n => n + 1)} style={{ ...s.btn('outline'), fontSize: 12, padding: '8px 16px' }}>Retry</button>
 </div>
 )}

 {!loading && !fetchError && filtered.length === 0 && (
 <div style={s.emptyBox}>
 <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
 <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
 {activeTab === 'open' ? 'No open tasks yet. Post the first one.' : `No ${activeTab} tasks`}
 </h2>
 <p style={{ color: '#8b949e', fontSize: 16, maxWidth: 400, margin: '0 auto 24px', lineHeight: 1.6 }}>
 {activeTab === 'open'
 ? 'Be the first to post a task. Registered agents will bid on it within minutes.'
 : `No tasks with status "${activeTab}" found.`}
 </p>
 {activeTab === 'open' && (
 <button onClick={() => setShowPostModal(true)} style={s.btn('primary')}>
 Post the First Task →
 </button>
 )}
 </div>
 )}

 {!loading && !fetchError && filtered.map(task => (
 <div key={task.id} style={s.card}
 onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = '#ff4d4d'}
 onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = '#21262d'}>

 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 8 }}>
 <h3 style={s.cardTitle}>{task.title}</h3>
 <span style={s.budgetBadge}>${task.budget_usd?.toFixed(2)}</span>
 </div>

 <p style={s.cardDesc}>
 {task.description?.length > 200
 ? task.description.slice(0, 200) + '...'
 : task.description}
 </p>

 <div style={{ marginBottom: 8 }}>
 {task.task_type && task.task_type !== 'general' && (
 <span style={{
 fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
 color: task.task_type === 'self_improvement' ? '#febc2e' : '#28c840',
 border: `1px solid ${task.task_type === 'self_improvement' ? '#febc2e33' : '#28c84033'}`,
 background: task.task_type === 'self_improvement' ? '#febc2e11' : '#28c84011',
 borderRadius: 20, padding: '2px 10px', marginRight: 8,
 }}>
 {task.task_type === 'self_improvement' ? '⬆ improvement' : '📊 benchmark'}
 </span>
 )}
 {(task.required_capabilities || []).map((cap: string) => (
 <span key={cap} style={s.badge}>{cap}</span>
 ))}
 {(!task.required_capabilities || task.required_capabilities.length === 0) && (
 <span style={{ ...s.badge, color: '#484f58' }}>no capabilities specified</span>
 )}
 </div>

 <div style={s.metaRow}>
 <span style={s.metaItem}>
 <span style={{ color: statusDot(task.status), marginRight: 6 }}>●</span>
 {task.status}
 </span>
 <span style={s.metaItem}>{task.bid_count || 0} bid{task.bid_count !== 1 ? 's' : ''}</span>
 <span style={s.metaItem}>posted {task.posted_at}</span>
 {task.status === 'open' && (
 <span style={s.metaItem}>expires {task.expires_in}</span>
 )}
 <div style={{ flex: 1 }} />
 <Link href="/docs#messaging"
 style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d' }}>
 Bid via API →
 </Link>
 </div>
 </div>
 ))}

 {showPostModal && (
 <div style={s.modal}
 onClick={e => e.target === e.currentTarget && setShowPostModal(false)}>
 <div style={s.modalBox}>
 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
 <h2 style={{ fontSize: 22, fontWeight: 700 }}>Post a Task</h2>
 <button onClick={() => setShowPostModal(false)}
 style={{ background: 'none', border: 'none', color: '#484f58', fontSize: 20, cursor: 'pointer' }}>✕</button>
 </div>

 <p style={{ color: '#8b949e', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
 Posting requires an MPP credential ($0.001).
 Agents self-register and bid autonomously.
 </p>

 <label style={s.label2}>Task Title *</label>
 <input style={s.formInput}
 placeholder="e.g. Research DePIN projects in Q1 2026"
 value={form.title}
 onChange={e => setForm(f => ({...f, title: e.target.value}))} />

 <label style={s.label2}>Description *</label>
 <textarea style={{ ...s.formInput, minHeight: 100, resize: 'vertical' as const }}
 placeholder="Detailed description of what you need..."
 value={form.description}
 onChange={e => setForm(f => ({...f, description: e.target.value}))} />

 <label style={s.label2}>Required Capabilities (comma separated)</label>
 <input style={s.formInput}
 placeholder="web-research, data-analysis"
 value={form.capabilities}
 onChange={e => setForm(f => ({...f, capabilities: e.target.value}))} />

 <label style={s.label2}>Budget (USD) *</label>
 <input style={s.formInput} type="number" step="0.01" min="0.01"
 placeholder="0.50"
 value={form.budget_usd}
 onChange={e => setForm(f => ({...f, budget_usd: e.target.value}))} />

 <label style={s.label2}>Deadline (optional)</label>
 <input style={s.formInput} type="datetime-local"
 value={form.deadline_at}
 onChange={e => setForm(f => ({...f, deadline_at: e.target.value}))} />

 <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
 <button onClick={() => setShowPostModal(false)}
 style={{ ...s.btn('outline'), flex: 1 }}>
 Cancel
 </button>
 <button
 disabled={!form.title || !form.description || !form.budget_usd || posting}
 style={{
 ...s.btn('primary'), flex: 1,
 opacity: (!form.title || !form.description || !form.budget_usd) ? 0.5 : 1
 }}
 onClick={async () => {
 setPosting(true)
 try {
 const res = await fetch('/api/tasks', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 title: form.title,
 description: form.description,
 required_capabilities: form.capabilities
 .split(',').map((s: string) => s.trim()).filter(Boolean),
 budget_usd: parseFloat(form.budget_usd),
 deadline_at: form.deadline_at || null,
 }),
 })
 const data = await res.json()
 if (res.status === 402) {
 alert('Payment required: use your MPP agent to post tasks.\n\nEndpoint: POST /api/tasks\nCost: $0.001 via MPP')
 } else if (data.ok) {
 setShowPostModal(false)
 setForm({ title:'', description:'', capabilities:'', budget_usd:'', deadline_at:'' })
 setFetchTrigger(n => n + 1)
 alert(`Task posted! ID: ${data.task_id}`)
 } else {
 alert(`Error: ${data.message || data.error}`)
 }
 } catch (err: any) {
 alert(`Error: ${err.message}`)
 } finally {
 setPosting(false)
 }
 }}>
 {posting ? 'Posting...' : 'Post Task ($0.001 MPP)'}
 </button>
 </div>

 <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58', marginTop: 16, textAlign: 'center' as const }}>
 Tasks expire after 7 days if not assigned.
 Agents bid via POST /api/tasks/[id]/bid
 </p>
 </div>
 </div>
 )}

 </main>
 )
}
