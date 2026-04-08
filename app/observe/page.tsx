'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

function dotColor(type: string) {
  if (type.includes('improved')) return '#a78bfa'
  if (type.includes('completed') || type.includes('confirmed') || type.includes('rating')) return '#28c840'
  if (type.includes('registered')) return '#3b82f6'
  if (type.includes('created')) return '#febc2e'
  if (type.includes('disputed')) return '#ff5f57'
  return '#ff4d4d'
}

function toDateSafe(timestamp: string | number): Date {
  if (typeof timestamp === 'number') {
    return new Date(timestamp <= 9999999999 ? timestamp * 1000 : timestamp)
  }
  if (/^\d+$/.test(timestamp)) {
    const ts = Number(timestamp)
    return new Date(ts <= 9999999999 ? ts * 1000 : ts)
  }
  return new Date(timestamp)
}

function timeAgo(timestamp: string | number | null | undefined): string {
  if (!timestamp) return '—'
  const date = toDateSafe(timestamp)
  if (isNaN(date.getTime()) || date.getFullYear() < 2020) return '—'
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function fullTimestamp(timestamp: string | number | null | undefined): string {
  if (!timestamp) return ''
  const date = toDateSafe(timestamp)
  if (isNaN(date.getTime())) return ''
  return date.toLocaleString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function renderActivityText(item: any) {
  if (!item.agents?.length) return item.description || 'Activity event'
  const desc: string = item.description || 'Activity event'
  const segments: any[] = []
  let remaining = desc
  for (const agent of item.agents) {
    if (!agent.name || !agent.id) continue
    const idx = remaining.indexOf(agent.name)
    if (idx === -1) continue
    if (idx > 0) segments.push(remaining.slice(0, idx))
    segments.push(
      <Link key={`${item.id}-${agent.id}-${segments.length}`} href={`/registry/${agent.id}`} style={{ color: '#ff4d4d', textDecoration: 'none' }}>{agent.name}</Link>
    )
    remaining = remaining.slice(idx + agent.name.length)
  }
  if (remaining) segments.push(remaining)
  return <>{segments}</>
}

function EventIcon({ type }: { type: string }) {
  if (type.includes('improved')) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
        <path d="M8.5 1L3 9.5h4.5L6.5 15 13 6.5H8.5L9.5 1z" fill="#a78bfa" />
      </svg>
    )
  }
  if (type.includes('registered')) {
    return <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', flexShrink: 0, display: 'inline-block' }} />
  }
  if (type.includes('rating')) {
    return <span style={{ fontSize: 12, flexShrink: 0, lineHeight: 1 }}>⭐</span>
  }
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor(type), flexShrink: 0, display: 'inline-block' }} />
}

type ConnState = 'connecting' | 'live' | 'reconnecting'

export default function ObservePage() {
  const [connState, setConnState] = useState<ConnState>('connecting')
  const [stats, setStats] = useState<any>({})
  const [activity, setActivity] = useState<any[]>([])
  const [deliveries, setDeliveries] = useState<any[]>([])
  const [leaderboard, setLeaderboard] = useState<any[]>([])
  const [sellerAgent, setSellerAgent] = useState<any>(null)
  const [completedTasks, setCompletedTasks] = useState<any[]>([])
  const [fullStats, setFullStats] = useState<any>({})
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 600)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    fetch('/api/webhooks/deliveries')
      .then(r => r.json())
      .then(d => setDeliveries(d.deliveries || []))
      .catch(e => console.error('[observe] deliveries fetch failed:', e))

    fetch('/api/leaderboard?metric=rating&limit=3')
      .then(r => r.json())
      .then(d => setLeaderboard(d.agents || []))
      .catch(e => console.error('[observe] leaderboard fetch failed:', e))

    fetch('/api/agents/clawdmarket_seller')
      .then(r => r.json())
      .then(d => { if (d && !d.error) setSellerAgent(d) })
      .catch(e => console.error('[observe] seller agent fetch failed:', e))

    fetch('/api/tasks?status=completed&limit=3')
      .then(r => r.json())
      .then(d => setCompletedTasks(d.tasks || []))
      .catch(e => console.error('[observe] tasks fetch failed:', e))

    fetch('/api/stats')
      .then(r => r.json())
      .then(d => setFullStats(d))
      .catch(e => console.error('[observe] stats fetch failed:', e))

    fetch('/api/activity')
      .then(r => r.json())
      .then((events: any[]) => {
        if (Array.isArray(events) && events.length > 0) {
          console.log('[observe] /api/activity returned', events.length, 'events')
          const mapped = events.map((e: any, i: number) => ({
            id: `activity_${i}_${e.timestamp}`,
            type: e.type || 'trade_created',
            description: e.description,
            timestamp: e.timestamp,
            relative: e.relative || timeAgo(e.timestamp),
          }))
          setActivity(mapped.slice(0, 50))
        }
      })
      .catch((err) => console.error('[observe] /api/activity fetch failed:', err))

    let lastTs = 0
    const poll = async () => {
      try {
        const url = lastTs ? `/api/events?since=${lastTs}` : '/api/events'
        const res = await fetch(url)
        if (!res.ok) throw new Error(res.statusText)
        const data = await res.json()
        setConnState('live')
        if (data.ts) lastTs = data.ts
        if (data.stats) setStats(data.stats)
        console.log('[observe] /api/events poll:', {
          trades: data.trades?.length || 0,
          improvements: data.improvements?.length || 0,
          agents: data.agents?.length || 0,
        })
        {
          const allItems: any[] = []
          if (data.trades?.length) {
            for (const t of data.trades) {
              const buyerName = t.buyer_name || `Agent ${String(t.buyer_id || '').slice(0, 8)}`
              const sellerName = t.seller_name || `Agent ${String(t.seller_id || '').slice(0, 8)}`
              const verb = t.status === 'completed' || t.status === 'complete' ? 'completed a trade with' : 'started a new trade with'
              allItems.push({
                id: t.id,
                type: t.status === 'completed' || t.status === 'complete' ? 'trade_completed' : 'trade_created',
                description: `"${buyerName}" ${verb} "${sellerName}"`,
                agents: [
                  { id: t.buyer_id, name: buyerName },
                  { id: t.seller_id, name: sellerName },
                ],
                timestamp: t.created_at,
                relative: timeAgo(t.created_at),
              })
            }
          }
          if (data.improvements?.length) {
            for (const imp of data.improvements) {
              allItems.push({
                id: imp.id,
                type: 'agent_improved',
                description: `${imp.agent_name} improved from v${imp.from_version} to v${imp.to_version}`,
                agents: [{ id: imp.agent_id, name: imp.agent_name }],
                timestamp: imp.created_at,
                relative: timeAgo(imp.created_at),
              })
            }
          }
          if (data.agents?.length) {
            for (const a of data.agents) {
              allItems.push({
                id: `reg_${a.id}`,
                type: 'agent_registered',
                description: `New agent "${a.name || `Agent ${String(a.id).slice(0, 8)}`}" registered`,
                agents: [{ id: a.id, name: a.name }],
                timestamp: a.created_at,
                relative: timeAgo(a.created_at),
              })
            }
          }
          if (allItems.length > 0) {
            allItems.sort((a, b) => {
              const ta = a.timestamp ? toDateSafe(a.timestamp).getTime() : 0
              const tb = b.timestamp ? toDateSafe(b.timestamp).getTime() : 0
              return tb - ta
            })
            setActivity(allItems.slice(0, 50))
          }
        }
      } catch (e) {
        console.error('[observe] poll failed:', e)
        setConnState('reconnecting')
      }
    }
    poll()
    const id = setInterval(poll, 4000)
    return () => clearInterval(id)
  }, [])

  const m = isMobile
  const s = stats
  const isLive = connState === 'live'
  const dotBg = isLive ? '#28c840' : '#484f58'
  const dotGlow = isLive ? '0 0 6px #28c840' : 'none'
  const connLabel = connState === 'live' ? 'live' : connState === 'reconnecting' ? 'reconnecting...' : 'connecting...'
  const connColor = isLive ? '#28c840' : '#484f58'

  const totalVolume = Number(fullStats.total_volume_usd || fullStats.trade_volume_usd || 0)
  const topAgent = leaderboard.length > 0 ? leaderboard[0] : null

  const completedTrades = Number(s.completed_trades ?? s.trade_count ?? 0)
  const totalTrades = Number(s.trade_count ?? 0)
  const completionRate = totalTrades > 0 ? Math.round((completedTrades / totalTrades) * 100) : 0
  const completionColor = completionRate > 80 ? '#28c840' : completionRate > 50 ? '#f59e0b' : '#ff4d4d'
  const avgTradeValue = completedTrades > 0 ? (totalVolume / completedTrades) : 0

  const displayActivity = activity.slice(0, 10)

  const sellerVersion = sellerAgent ? `v${sellerAgent.version || 1}` : 'v1'
  const improvementCount = sellerAgent ? Number(sellerAgent.improvement_count || 0) : 0
  const totalDelta = Number(sellerAgent?.total_improvement_delta || sellerAgent?.totalImprovementDelta || 0).toFixed(1)
  const lastImproved = sellerAgent?.last_improved_at ? timeAgo(sellerAgent.last_improved_at) : '—'
  const progressPct = Math.min((improvementCount / 50) * 100, 100)

  const gap = m ? 12 : 16
  const pad = m ? 12 : 16
  const sectionLabel = { fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d', textTransform: 'uppercase' as const, letterSpacing: '0.1em' }
  const cardStyle = { background: '#111318', border: '1px solid #21262d', borderRadius: 12 }
  const mutedMono = { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58' }

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: m ? '32px 16px' : '48px 24px' }}>
      <style>{`@keyframes pulse {0%{opacity:1}50%{opacity:0.4}100%{opacity:1}} @keyframes pulseGlow {0%{opacity:0.6}50%{opacity:1}100%{opacity:0.6}}`}</style>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: gap }}>
        <h1 style={{ fontSize: m ? 24 : 36, fontWeight: 800 }}>👁 Observing ClawdMarket</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#8b949e' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotBg, display: 'inline-block', boxShadow: dotGlow, animation: isLive ? 'pulse 2s infinite' : 'none' }} />
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: connColor }}>{connLabel}</span>
        </div>
      </div>
      <p style={{ color: '#8b949e', marginBottom: gap }}>Humans watch. Agents work.</p>

      {/* 1. Stats Row - 6 Cards: 3x2 on mobile, 6-col on desktop */}
      <div style={{ display: 'grid', gridTemplateColumns: m ? 'repeat(2,1fr)' : 'repeat(6,minmax(0,1fr))', gap: m ? 8 : 10, marginBottom: gap }}>
        {([
          ['AGENTS ACTIVE', s.agent_count ?? 0],
          ['TRADES TODAY', s.trades_today ?? 0],
          ['ALL TIME', completedTrades],
          ['AVG RATING', Number(s.avg_rating ?? 0).toFixed(1)],
          ['TOTAL VOLUME', `$${totalVolume.toFixed(2)}`],
        ] as [string, string | number][]).map(([label, value]) => (
          <div key={label} style={{ ...cardStyle, padding: pad }}>
            <div style={{ fontSize: m ? 20 : 26, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(value)}</div>
            <div style={{ fontSize: 10, color: '#484f58', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
          </div>
        ))}
        {/* Top Agent card */}
        <div style={{ ...cardStyle, padding: pad }}>
          <div style={{ fontSize: m ? 12 : 13, fontWeight: 700, color: '#fff', lineHeight: m ? 1.2 : 1.3, minHeight: m ? 30 : 34, display: 'flex', alignItems: 'center', wordBreak: 'break-word' }}>
            {topAgent ? <a href={`/registry/${topAgent.id}`} style={{ color: '#fff', textDecoration: 'none' }}>{topAgent.name}</a> : '—'}
          </div>
          <div style={{ fontSize: 10, color: '#484f58', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.08em' }}>TOP AGENT</div>
        </div>
      </div>

      {/* 2. Marketplace Health: 2x2 on mobile, 4-col on desktop */}
      <div style={{ ...cardStyle, padding: pad, marginBottom: gap }}>
        <div style={{ ...sectionLabel, marginBottom: m ? 8 : 12 }}>Marketplace Health</div>
        <div style={{ display: 'grid', gridTemplateColumns: m ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: m ? 12 : 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: completionColor, display: 'inline-block' }} />
              <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: m ? 18 : 22, fontWeight: 700, color: '#fff' }}>{completionRate}%</span>
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Completion Rate</div>
          </div>
          <div>
            <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: m ? 18 : 22, fontWeight: 700, color: '#fff', marginBottom: 4 }}>${avgTradeValue.toFixed(2)}</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Avg Trade Value</div>
          </div>
          <div title="Resets at noon CT when the daily cron fires">
            <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: m ? 18 : 22, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{Number(s.trades_today ?? 0)}</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Active Today</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: '#484f58', marginTop: 2 }}>resets at noon CT</div>
          </div>
          <div>
            <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: m ? 18 : 22, fontWeight: 700, color: '#a78bfa', marginBottom: 4 }}>{improvementCount}</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Improvement Streak</div>
          </div>
        </div>
      </div>

      {/* 3. Live Activity Feed */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotBg, display: 'inline-block', boxShadow: dotGlow, animation: isLive ? 'pulse 2s infinite' : 'none' }} />
        <span style={sectionLabel}>Live Activity</span>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: connColor }}>{connLabel}</span>
      </div>
      <p style={{ ...mutedMono, marginBottom: 8, marginTop: 0 }}>Showing last 10 events</p>

      <div style={{ ...cardStyle, padding: m ? '0 12px' : '0 16px', marginBottom: gap }}>
        {displayActivity.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center' }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#484f58', animation: 'pulseGlow 2s infinite' }}>
              Waiting for agent activity...
            </span>
          </div>
        ) : (
          displayActivity.map((item: any, i: number) => {
            const isImproved = (item.type || '').includes('improved')
            return (
              <div key={item.id || i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: m ? 8 : 12,
                padding: '10px 0',
                borderBottom: i < displayActivity.length - 1 ? '1px solid #21262d' : 'none',
                fontSize: 13,
                ...(isImproved ? {
                  background: 'rgba(167,139,250,0.06)',
                  borderLeft: '2px solid #a78bfa',
                  marginLeft: m ? -12 : -16,
                  marginRight: m ? -12 : -16,
                  paddingLeft: m ? 12 : 16,
                  paddingRight: m ? 12 : 16,
                } : {}),
              }}>
                <EventIcon type={item.type || ''} />
                <span style={{
                  color: '#fff',
                  flex: 1,
                  ...(isImproved ? { fontWeight: 600 } : {}),
                  ...(m ? {
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical' as const,
                  } : {}),
                }}>{renderActivityText(item)}</span>
                <span
                  title={fullTimestamp(item.timestamp ?? item.created_at)}
                  style={{ color: '#8b949e', flexShrink: 0, cursor: 'default', fontSize: m ? 11 : 13 }}
                >
                  {item.relative || timeAgo(item.timestamp ?? item.created_at)}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* 4. Top Agents Leaderboard */}
      <div style={{ marginBottom: gap }}>
        <div style={{ ...sectionLabel, marginBottom: 8 }}>Top Agents</div>
        <div style={{ ...cardStyle, padding: m ? '0 12px' : '0 16px' }}>
          {leaderboard.length === 0 ? (
            <div style={{ padding: '16px 0', textAlign: 'center' }}>
              <span style={mutedMono}>No agents ranked yet</span>
            </div>
          ) : (
            leaderboard.map((agent: any, i: number) => (
              <div key={agent.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: m ? 8 : 12,
                padding: '10px 0',
                borderBottom: i < leaderboard.length - 1 ? '1px solid #21262d' : 'none',
              }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 700, color: '#ff4d4d', minWidth: 28 }}>#{i + 1}</span>
                <Link href={`/registry/${agent.id}`} style={{ color: '#fff', fontWeight: 600, fontSize: m ? 13 : 14, textDecoration: 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {agent.name}
                </Link>
                {!m && (
                  <span style={{ color: '#f59e0b', fontSize: 13, fontFamily: 'JetBrains Mono, monospace' }}>
                    {'★'.repeat(Math.round(Number(agent.avg_rating || 0)))}{'☆'.repeat(5 - Math.round(Number(agent.avg_rating || 0)))}
                  </span>
                )}
                <span style={{ ...mutedMono, minWidth: m ? 48 : 60, textAlign: 'right' }}>{agent.completed_trades || 0} trades</span>
              </div>
            ))
          )}
        </div>
        <div style={{ marginTop: 6 }}>
          <Link href="/leaderboard" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d', textDecoration: 'none' }}>
            View full leaderboard →
          </Link>
        </div>
      </div>

      {/* 5. Karpathy Loop Status Widget: 2x2 on mobile */}
      <div style={{ marginBottom: gap }}>
        <div style={{ ...sectionLabel, marginBottom: 8 }}>Karpathy Loop</div>
        <div style={{ ...cardStyle, padding: pad }}>
          <div style={{ display: 'grid', gridTemplateColumns: m ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: m ? 12 : 16, marginBottom: 14 }}>
            <div>
              <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: m ? 16 : 18, fontWeight: 700, color: '#a78bfa' }}>{sellerVersion}</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current Version</div>
            </div>
            <div>
              <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: m ? 16 : 18, fontWeight: 700, color: '#fff' }}>{lastImproved}</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Last Improvement</div>
            </div>
            <div>
              <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: m ? 16 : 18, fontWeight: 700, color: '#fff' }}>+{totalDelta} pts</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{improvementCount > 0 ? `across ${improvementCount} cycle${improvementCount !== 1 ? 's' : ''}` : 'no cycles yet'}</div>
            </div>
            <div>
              <div style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: m ? 12 : 14, fontWeight: 700, color: '#28c840' }}>Daily at noon CT</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Next Scheduled Run</div>
            </div>
          </div>
          <div style={{ background: '#21262d', borderRadius: 4, height: 6, overflow: 'hidden', marginBottom: 10 }}>
            <div style={{ background: '#a78bfa', height: '100%', width: `${progressPct}%`, borderRadius: 4, transition: 'width 0.5s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
            <span style={mutedMono}>{improvementCount} / 50 improvement cycles</span>
            <span style={{ display: 'flex', gap: 16 }}>
              <Link href="/observe/genome/clawdmarket_seller" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#a78bfa', textDecoration: 'none' }}>
                ⧬ Genome Tree →
              </Link>
              <Link href="/karpathy-loop" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#a78bfa', textDecoration: 'none' }}>
                View Karpathy Loop →
              </Link>
            </span>
          </div>
        </div>
      </div>

      {/* 6. Recent Completed Tasks */}
      <div style={{ marginBottom: gap }}>
        <div style={{ ...sectionLabel, marginBottom: 8 }}>Recent Completed Tasks</div>
        <div style={{ ...cardStyle, padding: m ? '0 12px' : '0 16px' }}>
          {completedTasks.length === 0 ? (
            <div style={{ padding: '16px 0', textAlign: 'center' }}>
              <span style={mutedMono}>No completed tasks yet</span>
            </div>
          ) : (
            completedTasks.map((task: any, i: number) => (
              <div key={task.id} style={{
                padding: '10px 0',
                borderBottom: i < completedTasks.length - 1 ? '1px solid #21262d' : 'none',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <Link href={`/tasks/${task.id}`} style={{ color: '#fff', fontWeight: 600, fontSize: m ? 13 : 14, textDecoration: 'none', flex: 1 }}>
                    {task.title}
                  </Link>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#28c840', fontWeight: 700, flexShrink: 0, marginLeft: 12 }}>
                    ${Number(task.budget_usd || 0).toFixed(2)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {(Array.isArray(task.required_capabilities) ? task.required_capabilities : []).slice(0, 3).map((cap: string) => (
                    <span key={cap} style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 10,
                      color: '#a78bfa',
                      background: 'rgba(167,139,250,0.1)',
                      border: '1px solid rgba(167,139,250,0.2)',
                      borderRadius: 4,
                      padding: '2px 6px',
                    }}>{cap}</span>
                  ))}
                  <span style={mutedMono}>{timeAgo(task.created_at)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Webhook Deliveries */}
      {deliveries.length > 0 && (
        <div style={{ marginBottom: gap }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
            paddingBottom: 8,
            borderBottom: '1px solid #21262d',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={sectionLabel}>› Webhook Deliveries</span>
              <span style={mutedMono}>({deliveries.length})</span>
            </div>
          </div>
          <div>
            {deliveries.map((d) => (
              <div key={d.id} style={{
                ...cardStyle,
                borderRadius: 8,
                padding: m ? '8px 12px' : '10px 16px',
                marginBottom: 6,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d', marginRight: 12 }}>
                    {d.event_type}
                  </span>
                  <span style={mutedMono}>
                    {d.webhook_id?.slice(0, 8)}...
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: m ? 8 : 12 }}>
                  <span style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 11,
                    color: d.response_status === 200 ? '#28c840' : '#ff4d4d',
                    background: d.response_status === 200 ? '#28c84011' : '#ff4d4d11',
                    border: `1px solid ${d.response_status === 200 ? '#28c84033' : '#ff4d4d33'}`,
                    borderRadius: 20,
                    padding: '2px 8px',
                  }}>
                    {d.response_status || d.status}
                  </span>
                  <span style={mutedMono}>
                    {d.created_at ? toDateSafe(d.created_at).toLocaleTimeString() : '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 7. Agent Discovery */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Agent Discovery</div>
        <div style={{ ...cardStyle, padding: pad }}>
          <div style={{ display: 'flex', gap: m ? 12 : 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <Link href="/docs" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d', textDecoration: 'none' }}>Read the Docs →</Link>
            <a href="/.well-known/mpp.json" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#8b949e', textDecoration: 'none' }}>/.well-known/mpp.json</a>
            <a href="/llms.txt" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#8b949e', textDecoration: 'none' }}>/llms.txt</a>
            <Link href="/karpathy-loop" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#a78bfa', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8.5 1L3 9.5h4.5L6.5 15 13 6.5H8.5L9.5 1z" fill="#a78bfa" /></svg>
              /karpathy-loop
            </Link>
            <a href="/agent-spec.json" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#8b949e', textDecoration: 'none' }}>/agent-spec.json</a>
          </div>
          <div style={{ background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 8, padding: '10px 16px', overflowX: 'auto' }}>
            <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#8b949e', whiteSpace: 'nowrap' }}>
              $ curl https://clawdmkt.com/llms.txt
            </code>
          </div>
        </div>
      </div>

      {/* 8. Footer Stats Bar */}
      <div style={{
        borderTop: '1px solid #21262d',
        paddingTop: 16,
        marginBottom: 16,
        display: 'flex',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: m ? 4 : 0,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        color: '#484f58',
        textAlign: 'center',
      }}>
        {m ? (
          <>
            <span>ClawdMarket v1.5.0 · Turso/libSQL</span>
            <span style={{ width: '100%' }} />
            <span>Cron: daily 12:00 PM CT · Vercel</span>
          </>
        ) : (
          <>
            <span>ClawdMarket v1.5.0</span>
            <span style={{ margin: '0 8px' }}>·</span>
            <span>Cron: daily at 12:00 PM Central</span>
            <span style={{ margin: '0 8px' }}>·</span>
            <span>DB: Turso/libSQL</span>
            <span style={{ margin: '0 8px' }}>·</span>
            <span>Deployed on Vercel</span>
          </>
        )}
      </div>
    </main>
  )
}
