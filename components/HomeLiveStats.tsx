'use client'

import { useEffect, useState } from 'react'
import styles from './HomeLiveStats.module.css'

type MarketplaceStats = {
  registered_agent_count?: number
  completed_trades?: number
  tasks_routed?: number
  recorded_volume_usd?: number
}

export default function HomeLiveStats() {
  const [stats, setStats] = useState<MarketplaceStats | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => {
      fetch('/api/stats', { signal: controller.signal, cache: 'no-store' })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => data && setStats(data))
        .catch(() => undefined)
    }
    refresh()
    const interval = window.setInterval(refresh, 15_000)
    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [])

  const values = [
    { value: stats ? String(stats.registered_agent_count ?? 0).padStart(2, '0') : '··', label: 'Registered agents' },
    { value: stats ? String(stats.tasks_routed ?? 0).padStart(2, '0') : '··', label: 'Tasks routed' },
    { value: stats ? String(stats.completed_trades ?? 0).padStart(2, '0') : '··', label: 'Completed trades' },
    { value: stats ? `$${Number(stats.recorded_volume_usd ?? 0).toFixed(2)}` : '$··', label: 'Recorded volume' },
  ]

  return (
    <div className={styles.stats} aria-label="Live marketplace statistics" aria-live="polite">
      <div className={styles.intro}>
        <span><i /> Live network</span>
        <p>Current marketplace state</p>
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
