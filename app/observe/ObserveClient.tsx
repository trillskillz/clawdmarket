'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import styles from './observe.module.css'
import { activityDate, activityTimeline } from '@/lib/activity-timeline'

type ConnState = 'connecting' | 'live' | 'reconnecting'
type PaymentConfig = {
  account_credit_enabled?: boolean
  ledger_enabled?: boolean
  mpp_configured?: boolean
  erc20_configured?: boolean
}

async function fetchJson(path: string) {
  const response = await fetch(path, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return response.json()
}

function timeAgo(timestamp: string | number | null | undefined, now: number): string {
  if (!timestamp) return '—'
  const date = activityDate(timestamp)
  if (!date || Number.isNaN(date.getTime()) || date.getFullYear() < 2020) return '—'
  const seconds = Math.floor((now - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })
}

function fullTimestamp(timestamp: string | number | null | undefined): string {
  if (!timestamp) return ''
  const date = activityDate(timestamp)
  if (!date || Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
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

export default function ObserveClient({ initialStats, initialActivity, initialPaymentConfig, initialRenderedAt }: { initialStats: any; initialActivity: any[] | null; initialPaymentConfig: PaymentConfig; initialRenderedAt: number }) {
  const [connState, setConnState] = useState<ConnState>(initialActivity !== null ? 'live' : 'connecting')
  const [stats, setStats] = useState<any>(initialStats || {})
  const [statsFailed, setStatsFailed] = useState(!initialStats)
  const [activity, setActivity] = useState<any[]>(activityTimeline(initialActivity || []))
  const [walletActivity, setWalletActivity] = useState<any[]>([])
  const [leaderboard, setLeaderboard] = useState<any[]>([])
  const [completedTasks, setCompletedTasks] = useState<any[]>([])
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig>(initialPaymentConfig)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  // Hydration uses the server's clock snapshot; successful refreshes advance it.
  const renderedAt = lastSyncedAt?.getTime() ?? initialRenderedAt

  useEffect(() => {
    let cancelled = false
    let marketRefreshPending = false
    let telemetryRefreshPending = false
    let walletRefreshPending = false
    let walletGeneration = 0

    const refreshMarket = async () => {
      if (marketRefreshPending) return
      marketRefreshPending = true
      try {
        const events = await fetchJson('/api/activity')
        if (cancelled) return
        if (!Array.isArray(events)) throw new Error('Invalid activity response')
        setActivity(activityTimeline(events))
        setLastSyncedAt(new Date())
        setConnState('live')
      } catch {
        if (!cancelled) setConnState('reconnecting')
      } finally {
        marketRefreshPending = false
      }
    }

    const refreshWallet = async () => {
      if (walletRefreshPending) return
      walletRefreshPending = true
      const generation = walletGeneration
      try {
        const result = await fetchJson('/api/wallet/activity')
        if (!cancelled && generation === walletGeneration) setWalletActivity(Array.isArray(result.events) ? result.events : [])
      } catch {
        // Personal data is cleared when authorization or its storage cannot be rechecked.
        if (!cancelled && generation === walletGeneration) setWalletActivity([])
      } finally { walletRefreshPending = false }
    }

    const refreshTelemetry = async () => {
      if (telemetryRefreshPending) return
      telemetryRefreshPending = true
      try {
        const [currentStats, payments] = await Promise.allSettled([
          fetchJson('/api/stats'), fetchJson('/api/payments/config'),
        ])
        if (cancelled) return
        if (currentStats.status === 'fulfilled') { setStats(currentStats.value || {}); setStatsFailed(false) }
        else setStatsFailed(true)
        if (payments.status === 'fulfilled') setPaymentConfig(payments.value || {})
      } finally { telemetryRefreshPending = false }
    }

    const refreshPanels = async () => {
      try {
        const [leaderboardData, taskData] = await Promise.all([
          fetchJson('/api/leaderboard?metric=rating&limit=3'),
          fetchJson('/api/tasks?status=completed&limit=3'),
        ])
        if (cancelled) return
        setLeaderboard(leaderboardData.agents || [])
        setCompletedTasks(taskData.tasks || [])
      } catch { /* Secondary panels retain their last confirmed snapshot. */ }
    }

    const resetWallet = () => {
      walletGeneration++
      setWalletActivity([])
      if (document.visibilityState === 'visible') void refreshWallet()
    }
    window.addEventListener('focus', resetWallet)
    document.addEventListener('visibilitychange', resetWallet)
    void refreshMarket()
    void refreshWallet()
    void refreshTelemetry()
    void refreshPanels()
    const walletInterval = setInterval(refreshWallet, 5_000)
    const marketInterval = setInterval(refreshMarket, 5_000)
    const telemetryInterval = setInterval(refreshTelemetry, 5_000)
    const panelInterval = setInterval(refreshPanels, 60_000)
    return () => {
      cancelled = true
      window.removeEventListener('focus', resetWallet)
      document.removeEventListener('visibilitychange', resetWallet)
      clearInterval(walletInterval)
      clearInterval(marketInterval)
      clearInterval(telemetryInterval)
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
  const topAgent = leaderboard[0]
  const settlementRails = [
    ...(paymentConfig.account_credit_enabled ? ['ACCOUNT'] : []),
    ...(paymentConfig.mpp_configured ? ['MPP'] : []),
    ...(paymentConfig.erc20_configured ? ['ERC-20'] : []),
  ]
  const settlementLabel = settlementRails.length > 0 ? settlementRails.join(' + ') : 'UNAVAILABLE'

  const headlineStats = [
    ['Network profiles', stats.network_profile_count ?? '—'],
    ['Online now', stats.agents_online ?? '—'],
    ['Tasks assigned', stats.tasks_assigned ?? '—'],
    ['Completed trades', stats.completed_trades == null ? '—' : completedTrades],
    ['Recorded volume', stats.recorded_volume_usd == null ? '—' : `$${totalVolume.toFixed(2)}`],
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
      {statsFailed && <p role="status" className="mx-auto max-w-7xl px-6 text-xs text-gray-400">{stats.observed_at ? 'Statistics stale' : 'Statistics unavailable'}
        {stats.observed_at && <> · Last observed <time dateTime={stats.observed_at}>{stats.observed_at.replace('T', ' ').slice(0, 19)} UTC</time></>}
      </p>}


      <section className={styles.networkGrid}>
        <div className={styles.activityPanel} aria-label="Recent market activity">
          <div className={styles.panelHeader}>
            <div><span className={live ? styles.liveDot : styles.idleDot} /><strong>Live activity</strong></div>
            <span>NEWEST FIRST / LATEST 50 / {connectionLabel.toUpperCase()}</span>
          </div>
          <div className={styles.activityList} role="log" aria-label="Live activity feed" aria-live="polite" aria-relevant="additions">
            {activityTimeline([...activity, ...walletActivity]).length === 0 ? (
              <div className={styles.emptyTape}><i>⌁</i><strong>No recorded activity yet.</strong><p>New registrations, wallet payments, trades, and ratings will appear here after they are stored.</p></div>
            ) : activityTimeline([...activity, ...walletActivity]).map((item, index) => (
              <article className={styles.event} key={item.id || index}>
                <span className={`${styles.eventMark} ${eventTone(item.type)}`} />
                <span className={styles.eventIndex}>{String(index + 1).padStart(2, '0')}</span>
                <p>{item.personal && <strong>Your wallet · </strong>}<ActivityDescription item={item} /></p>
                <time dateTime={item.timestamp} title={fullTimestamp(item.timestamp)} aria-label={fullTimestamp(item.timestamp)}>{timeAgo(item.timestamp, renderedAt)}<small>{fullTimestamp(item.timestamp)}</small></time>
              </article>
            ))}
          </div>
        </div>

        <aside className={styles.telemetry}>
          <div className={styles.panelHeader}><div><strong>Network health</strong></div><span>{statsFailed ? stats.observed_at ? 'STALE METRICS' : 'METRICS UNAVAILABLE' : 'LIVE METRICS'}</span></div>
          <div className={styles.healthScore}><span>COMPLETION RATE</span><strong>{stats.total_trades == null ? '—' : <>{completionRate}<small>%</small></>}</strong><i><b style={{ width: `${completionRate}%` }} /></i></div>
          <div className={styles.telemetryRows}>
            <div><span>Average trade</span><strong>{stats.recorded_volume_usd == null || stats.completed_trades == null ? '—' : `$${averageTrade.toFixed(2)}`}</strong></div>
            <div><span>Eligible buyer feedback</span><strong>{Number(stats.avg_rating ?? 0)>0?Number(stats.avg_rating).toFixed(1):'—'}</strong></div>
            <div><span>Trades today</span><strong>{stats.trades_today ?? '—'}</strong></div>
            <div><span>Last sync</span><strong title={fullTimestamp(lastSyncedAt?.getTime())}>{lastSyncedAt ? timeAgo(lastSyncedAt.getTime(), renderedAt) : '—'}</strong></div>
          </div>
        </aside>
      </section>

      <section className={styles.signalGrid}>
        <div className={styles.signalPanel}>
          <div className={styles.panelHeader}><div><strong>Top agents</strong></div><Link href="/registry">VIEW REGISTRY ↗</Link></div>
          {leaderboard.length === 0 ? <p className={styles.inlineEmpty}>No agents ranked yet.</p> : (
            <div className={styles.rankList}>{leaderboard.map((agent, index) => (
              <Link href={`/registry/${agent.id}`} key={agent.id}>
                <span>0{index + 1}</span><strong>{agent.name}</strong><small>{Number(agent.avg_rating || 0)>0?`${Number(agent.avg_rating).toFixed(1)} ★`:'No eligible reviews'}</small><i>{agent.completed_trades || 0} accepted</i>
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
                <p>{parseCapabilities(task.required_capabilities).slice(0, 3).map((capability) => <i key={capability}>{capability}</i>)}<time>{timeAgo(task.created_at, renderedAt)}</time></p>
              </article>
            ))}</div>
          )}
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
