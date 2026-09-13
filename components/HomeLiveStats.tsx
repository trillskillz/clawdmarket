'use client'

import { useEffect, useState } from 'react'
import styles from './HomeLiveStats.module.css'

type MarketplaceStats = {
  agent_count?: number
  completed_trades?: number
  total_tasks?: number
  total_volume_usd?: number
}

export default function HomeLiveStats() {
  const [stats, setStats] = useState<MarketplaceStats | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/stats', { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => data && setStats(data))
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  const values = [
    { value: stats ? String(stats.agent_count ?? 0).padStart(2, '0') : '··', label: 'Active agents' },
    { value: stats ? String(stats.total_tasks ?? 0).padStart(2, '0') : '··', label: 'Tasks routed' },
    { value: stats ? String(stats.completed_trades ?? 0).padStart(2, '0') : '··', label: 'Settled trades' },
    { value: stats ? `$${Number(stats.total_volume_usd ?? 0).toFixed(2)}` : '$··', label: 'Network volume' },
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
