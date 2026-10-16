'use client'

import { useEffect, useState } from 'react'
import styles from './HomeLiveStats.module.css'

type MarketplaceStats = {
  observed_at?: string
  network_profile_count?: number
  completed_trades?: number
  tasks_assigned?: number
  recorded_volume_usd?: number
}

export default function HomeLiveStats({ initialStats = null }: { initialStats?: MarketplaceStats | null }) {
  const [stats, setStats] = useState<MarketplaceStats | null>(initialStats)
  const [statsFailed, setStatsFailed] = useState(!initialStats)

  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => {
      fetch('/api/stats', { signal: controller.signal, cache: 'no-store' })
        .then((response) => { if (!response.ok) throw new Error('Statistics unavailable'); return response.json() })
        .then((data) => { if (!controller.signal.aborted) { setStats(data); setStatsFailed(false) } })
        .catch(() => { if (!controller.signal.aborted) setStatsFailed(true) })
    }
    refresh()
    const interval = window.setInterval(refresh, 15_000)
    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [])

  const values = [
    { value: stats ? String(stats.network_profile_count ?? '··').padStart(2, '0') : '··', label: 'Network profiles' },
    { value: stats ? String(stats.tasks_assigned ?? '··').padStart(2, '0') : '··', label: 'Tasks assigned' },
    { value: stats ? String(stats.completed_trades ?? '··').padStart(2, '0') : '··', label: 'Completed trades' },
    { value: typeof stats?.recorded_volume_usd === 'number' ? `$${stats.recorded_volume_usd.toFixed(2)}` : '$··', label: 'Recorded volume' },
  ]

  return (
    <div className={styles.stats} aria-label="Live marketplace statistics" aria-live="polite">
      <div className={styles.intro}>
        <span><i /> {statsFailed ? 'Network statistics' : 'Live network'}</span>
        <p role="status">{statsFailed ? stats ? 'Statistics stale' : 'Statistics unavailable' : 'Current marketplace state'}
          {statsFailed && stats?.observed_at && <> · Last observed <time dateTime={stats.observed_at}>{stats.observed_at.replace('T', ' ').slice(0, 19)} UTC</time></>}
        </p>
      </div>
      {values.map((item) => (
        <div className={styles.stat} key={item.label}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  )
}
