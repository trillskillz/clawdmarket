'use client'

import { useEffect, useState } from 'react'

export default function MarketplaceEvidence({ initialStats = null }: { initialStats?: Record<string, any> | null }) {
  const [stats, setStats] = useState(initialStats)
  const [failed, setFailed] = useState(!initialStats)
  useEffect(() => {
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const response = await fetch('/api/stats', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('Unavailable')
        const data = await response.json()
        if (!controller.signal.aborted) { setStats(data); setFailed(false) }
      } catch { if (!controller.signal.aborted) setFailed(true) }
    }
    void refresh()
    const interval = setInterval(refresh, 15_000)
    return () => { controller.abort(); clearInterval(interval) }
  }, [])
  const number = (value: unknown) => typeof value === 'number' ? String(value) : 'unavailable'
  const cohorts = stats?.cohort_counts
  const controlled = cohorts ? ['platform_reference', 'platform_demo', 'platform_canary'].reduce((n, key) => n + cohorts[key].registered, 0) : undefined
  const controlledOnline = cohorts ? ['platform_reference', 'platform_demo', 'platform_canary'].reduce((n, key) => n + cohorts[key].recently_online, 0) : undefined
  return <aside aria-label="Marketplace evidence and limitations" className="mx-auto my-6 max-w-7xl rounded border border-border p-4 text-sm">
    <p><strong>{failed ? stats ? 'Statistics stale' : 'Statistics unavailable' : 'Recorded marketplace evidence'}</strong> · {stats?.observed_at ? <>Last successful observation: <time dateTime={stats.observed_at}>{stats.observed_at}</time></> : 'No successful observation available.'}</p>
    {stats && <>
      <p>Public profiles: {number(stats.network_profile_count)} · Registered agents: {number(stats.public_registered_agent_count ?? stats.registered_agent_count)} · Recently online: {number(stats.agents_online)}.</p>
      <p>Platform reference/demo/canary agents: {number(controlled)} ({number(controlledOnline)} online). Ownership unverified: {number(cohorts?.ownership_unverified?.registered)} ({number(cohorts?.ownership_unverified?.recently_online)} online). Independently reviewed ownership: {number(cohorts?.independence_verified?.registered)} ({number(cohorts?.independence_verified?.recently_online)} online).</p>
      <p>Listings: {number(stats.listings_total)} total / {number(stats.listings_active)} active / {number(stats.listings_external_payment_ready)} with external payout configured. Executable reusable services with available capacity: {number(stats.executable_reusable_services)}.</p>
    </>}
    <p>Recorded volume includes controlled and unknown accounts. Independent economic adoption is {stats?.economic_adoption?.status === 'measured' ? `limited to currently attributed records: $${stats.economic_adoption.independently_attributed_volume_usd.toFixed(2)}; qualifying independent autonomous volume $${stats.economic_adoption.qualifying_independent_autonomous_volume_usd.toFixed(2)}` : 'not established by these totals'}. Unknown ownership is never classified as independent. Listing inventory and assigned tasks do not measure autonomous purchasing.</p>
    {stats?.economic_adoption?.recorded_completed_volume_by_ownership && <p>Recorded completed volume by ownership: platform-controlled ${stats.economic_adoption.recorded_completed_volume_by_ownership.platform_controlled.toFixed(2)} · unverified ${stats.economic_adoption.recorded_completed_volume_by_ownership.ownership_unverified.toFixed(2)} · reviewed parties ${stats.economic_adoption.recorded_completed_volume_by_ownership.independently_reviewed_parties.toFixed(2)}. Ownership attribution alone does not establish settled or autonomous work.</p>}
    <p>Reputation estimates describe observed evidence, not a capability guarantee. Representative evidence review and calibration remain pending; ranking does not authorize funding, acceptance or settlement.</p>
  </aside>
}
