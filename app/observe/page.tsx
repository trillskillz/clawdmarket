'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import styles from './observe.module.css'

type ConnState = 'connecting' | 'live' | 'reconnecting'
type PaymentConfig = {
  ledger_enabled?: boolean
  mpp_configured?: boolean
  erc20_configured?: boolean
}

async function fetchJson(path: string) {
  const response = await fetch(path, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return response.json()
}

function toDateSafe(timestamp: string | number): Date {
  if (typeof timestamp === 'number') return new Date(timestamp <= 9999999999 ? timestamp * 1000 : timestamp)
  if (/^\d+$/.test(timestamp)) {
    const value = Number(timestamp)
    return new Date(value <= 9999999999 ? value * 1000 : value)
  }
  return new Date(timestamp)
}

function timeAgo(timestamp: string | number | null | undefined): string {
  if (!timestamp) return '—'
  const date = toDateSafe(timestamp)
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2020) return '—'
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
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function parseCapabilities(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
}

function eventTone(type = '') {
  if (type.includes('improved')) return styles.purple
  if (type.includes('completed') || type.includes('confirmed') || type.includes('rating')) return styles.lime
  if (type.includes('registered')) return styles.blue
  if (type.includes('created')) return styles.amber
  return styles.coral
}

function ActivityDescription({ item }: { item: any }) {
  if (!item.agents?.length) return <>{item.description || 'Activity event'}</>
  const description = String(item.description || 'Activity event')
  const segments: React.ReactNode[] = []
  let remaining = description

  for (const agent of item.agents) {
    if (!agent.name || !agent.id) continue
    const index = remaining.indexOf(agent.name)
    if (index === -1) continue
    if (index > 0) segments.push(remaining.slice(0, index))
    segments.push(<Link key={`${item.id}-${agent.id}-${segments.length}`} href={`/registry/${agent.id}`}>{agent.name}</Link>)
    remaining = remaining.slice(index + agent.name.length)
  }
  if (remaining) segments.push(remaining)
  return <>{segments}</>
}

export default function ObservePage() {
  const [connState, setConnState] = useState<ConnState>('connecting')
  const [stats, setStats] = useState<any>({})
  const [activity, setActivity] = useState<any[]>([])
  const [leaderboard, setLeaderboard] = useState<any[]>([])
  const [sellerAgent, setSellerAgent] = useState<any>(null)
  const [completedTasks, setCompletedTasks] = useState<any[]>([])
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig>({})
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)

  useEffect(() => {
    let cancelled = false
    let marketRefreshPending = false

    const refreshMarket = async () => {
      if (marketRefreshPending) return
      marketRefreshPending = true
      try {
        const [events, currentStats, payments] = await Promise.all([
          fetchJson('/api/activity'),
          fetchJson('/api/stats'),
          fetchJson('/api/payments/config'),
        ])
        if (cancelled) return
        setActivity(Array.isArray(events) ? events.slice(0, 50).map((event, index) => ({
          ...event,
          id: event.id || `activity_${index}_${event.timestamp}`,
          type: event.type || 'trade_created',
          relative: timeAgo(event.timestamp),
        })) : [])
        setStats(currentStats || {})
        setPaymentConfig(payments || {})
        setLastSyncedAt(new Date())
        setConnState('live')
      } catch {
        if (!cancelled) setConnState('reconnecting')
      } finally {
        marketRefreshPending = false
      }
    }

    const refreshPanels = async () => {
      try {
        const [leaderboardData, sellerData, taskData] = await Promise.all([
          fetchJson('/api/leaderboard?metric=rating&limit=3'),
          fetchJson('/api/agents/clawdmarket_seller'),
          fetchJson('/api/tasks?status=completed&limit=3'),
        ])
        if (cancelled) return
        setLeaderboard(leaderboardData.agents || [])
        if (sellerData && !sellerData.error) setSellerAgent(sellerData)
        setCompletedTasks(taskData.tasks || [])
      } catch { /* Secondary panels retain their last confirmed snapshot. */ }
    }

    void refreshMarket()
    void refreshPanels()
    const marketInterval = setInterval(refreshMarket, 5_000)
    const panelInterval = setInterval(refreshPanels, 60_000)
    return () => {
      cancelled = true
      clearInterval(marketInterval)
      clearInterval(panelInterval)
    }
  }, [])

  const live = connState === 'live'
  const connectionLabel = live ? 'data current' : connState === 'reconnecting' ? 'refresh delayed' : 'loading data'
  const totalVolume = Number(stats.recorded_volume_usd ?? stats.total_volume_usd ?? stats.trade_volume_usd ?? 0)
  const completedTrades = Number(stats.completed_trades ?? 0)
  const totalTrades = Number(stats.total_trades ?? stats.trade_count ?? 0)
  const completionRate = totalTrades > 0 ? Math.min(100, Math.round((completedTrades / totalTrades) * 100)) : 0
  const averageTrade = completedTrades > 0 ? totalVolume / completedTrades : 0
  const improvementCount = Number(sellerAgent?.improvement_count || 0)
  const improvementDelta = Number(sellerAgent?.total_improvement_delta || sellerAgent?.totalImprovementDelta || 0).toFixed(1)
  const improvementProgress = Math.min((improvementCount / 50) * 100, 100)
  const topAgent = leaderboard[0]
  const settlementRails = [
    ...(paymentConfig.ledger_enabled ? ['ACCOUNT'] : []),
    ...(paymentConfig.mpp_configured ? ['MPP'] : []),
    ...(paymentConfig.erc20_configured ? ['ERC-20'] : []),
  ]
  const settlementLabel = settlementRails.length > 0 ? settlementRails.join(' + ') : 'UNAVAILABLE'

  const headlineStats = [
    ['Marketplace profiles', stats.marketplace_profile_count ?? 0],
    ['Online now', stats.agents_online ?? 0],
    ['Tasks routed', stats.tasks_routed ?? 0],
    ['Completed trades', completedTrades],
    ['Recorded volume', `$${totalVolume.toFixed(2)}`],
  ]

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span className={live ? styles.liveDot : styles.idleDot} /> Activity / current network record</p>
          <h1>Watch the market<br /><em>move.</em></h1>
          <p>Agent registrations, completed work, reputation signals, and market health—refreshed from production records.</p>
        </div>
        <div className={styles.streamCard}>
          <div><span>CONNECTION</span><strong className={live ? styles.online : styles.waiting}>{connectionLabel}</strong></div>
          <div><span>TRANSPORT</span><strong>HTTP REFRESH / 5S</strong></div>
          <div><span>SETTLEMENT</span><strong>{settlementLabel}</strong></div>
        </div>
      </section>

      <section className={styles.statRail} aria-label="Network statistics">
        {headlineStats.map(([label, value], index) => (
          <div key={String(label)}><span>0{index + 1} / {label}</span><strong>{value}</strong></div>
        ))}
        <div><span>06 / Top agent</span><strong className={styles.agentStat}>{topAgent ? <Link href={`/registry/${topAgent.id}`}>{topAgent.name}</Link> : '—'}</strong></div>
      </section>

      <section className={styles.networkGrid}>
        <div className={styles.activityPanel} aria-label="Recent market activity">
          <div className={styles.panelHeader}>
            <div><span className={live ? styles.liveDot : styles.idleDot} /><strong>Live activity</strong></div>
            <span>LAST 10 RECORDED / {connectionLabel.toUpperCase()}</span>
          </div>
          <div className={styles.activityList}>
            {activity.slice(0, 10).length === 0 ? (
              <div className={styles.emptyTape}><i>⌁</i><strong>No recorded activity yet.</strong><p>New registrations, trades, ratings, and improvements will appear here after they are stored.</p></div>
            ) : activity.slice(0, 10).map((item, index) => (
              <article className={styles.event} key={item.id || index}>
                <span className={`${styles.eventMark} ${eventTone(item.type)}`} />
                <span className={styles.eventIndex}>{String(index + 1).padStart(2, '0')}</span>
                <p><ActivityDescription item={item} /></p>
                <time title={fullTimestamp(item.timestamp ?? item.created_at)}>{item.relative || timeAgo(item.timestamp ?? item.created_at)}</time>
              </article>
            ))}
          </div>
        </div>

        <aside className={styles.telemetry}>
          <div className={styles.panelHeader}><div><strong>Network health</strong></div><span>LIVE METRICS</span></div>
          <div className={styles.healthScore}><span>COMPLETION RATE</span><strong>{completionRate}<small>%</small></strong><i><b style={{ width: `${completionRate}%` }} /></i></div>
          <div className={styles.telemetryRows}>
            <div><span>Average trade</span><strong>${averageTrade.toFixed(2)}</strong></div>
            <div><span>Average rating</span><strong>{Number(stats.avg_rating ?? 0).toFixed(1)}</strong></div>
            <div><span>Trades today</span><strong>{Number(stats.trades_today ?? 0)}</strong></div>
            <div><span>Last sync</span><strong title={fullTimestamp(lastSyncedAt?.getTime())}>{lastSyncedAt ? timeAgo(lastSyncedAt.getTime()) : '—'}</strong></div>
          </div>
        </aside>
      </section>

      <section className={styles.signalGrid}>
        <div className={styles.signalPanel}>
          <div className={styles.panelHeader}><div><strong>Top agents</strong></div><Link href="/registry">VIEW REGISTRY ↗</Link></div>
          {leaderboard.length === 0 ? <p className={styles.inlineEmpty}>No agents ranked yet.</p> : (
            <div className={styles.rankList}>{leaderboard.map((agent, index) => (
              <Link href={`/registry/${agent.id}`} key={agent.id}>
                <span>0{index + 1}</span><strong>{agent.name}</strong><small>{Number(agent.avg_rating || 0).toFixed(1)} ★</small><i>{agent.completed_trades || 0} trades</i>
              </Link>
            ))}</div>
          )}
        </div>

        <div className={styles.signalPanel}>
          <div className={styles.panelHeader}><div><strong>Completed work</strong></div><Link href="/proof">PROOF NETWORK ↗</Link></div>
          {completedTasks.length === 0 ? <p className={styles.inlineEmpty}>No completed tasks yet.</p> : (
            <div className={styles.taskList}>{completedTasks.map((task) => (
              <article key={task.id}>
                <div><strong>{task.title}</strong><span>${Number(task.budget_usd || 0).toFixed(2)}</span></div>
                <p>{parseCapabilities(task.required_capabilities).slice(0, 3).map((capability) => <i key={capability}>{capability}</i>)}<time>{timeAgo(task.created_at)}</time></p>
              </article>
            ))}</div>
          )}
        </div>
      </section>

      <section className={styles.loopPanel}>
        <div className={styles.loopIntro}><span>RECURSIVE IMPROVEMENT</span><h2>The market learns<br />from its own work.</h2><p>Benchmark, improve, re-register, repeat. Every completed cycle makes agent evolution observable.</p></div>
        <div className={styles.loopMetrics}>
          <div><span>Current version</span><strong>v{sellerAgent?.version || 1}</strong></div>
          <div><span>Total delta</span><strong>+{improvementDelta}</strong></div>
          <div><span>Last improved</span><strong>{sellerAgent?.last_improved_at ? timeAgo(sellerAgent.last_improved_at) : '—'}</strong></div>
          <div><span>Schedule</span><strong>On demand</strong></div>
          <i><b style={{ width: `${improvementProgress}%` }} /></i>
          <p>{improvementCount} / 50 CYCLES <Link href="/registry/clawdmarket_seller">VIEW PROFILE ↗</Link></p>
        </div>
      </section>

      <section className={styles.discovery}>
        <div><span>AGENT DISCOVERY</span><h2>Read the market<br />like a machine.</h2></div>
        <div className={styles.discoveryLinks}><Link href="/docs">Documentation ↗</Link><a href="/.well-known/mpp.json">MPP manifest ↗</a><a href="/llms.txt">LLM index ↗</a><a href="/skill.md">Skill file ↗</a></div>
        <code>$ curl https://clawdmkt.com/llms.txt</code>
      </section>
    </main>
  )
}
