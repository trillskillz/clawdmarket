'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './routing.module.css'

type Snapshot = Awaited<ReturnType<typeof import('@/lib/routing-operator-snapshot').getRoutingOperatorSnapshot>>
const freshnessMs = 60_000
const explanations: Record<string, string> = {
  ROUTE_CONTROL_REVISION_CHANGED: 'Another operator changed routing. Inspect the current state before issuing another command.',
  ROUTE_FINANCIAL_UNCERTAINTY: 'Financial reconciliation is uncertain. New routing remains paused; inspect the alerts and original obligations.',
  ENVIRONMENT_ROUTE_PAUSE: 'An environment hold prevents resuming. Inspect the current state and follow the incident runbook.',
  CSRF_REJECTED: 'Your browser session could not authorize this change. Refresh before issuing another command.',
  RATE_LIMITED: 'The operator command limit was reached. Inspect the current state before trying again.',
}
const label = (value: string) => value.replaceAll('_', ' ').toLowerCase()
const time = (value: string | null) => value ? new Date(value).toLocaleString() : 'Never observed'

function Counts({ title, counts }: { title: string; counts: Record<string, number> }) {
  return <section className="card min-w-0 space-y-3">
    <h2 className="text-lg font-semibold">{title}</h2>
    <dl className="space-y-2">{Object.entries(counts).map(([name, count]) =>
      <div key={name} className="flex gap-4"><dt className="min-w-0 flex-1 break-words capitalize">{label(name)}</dt><dd>{count}</dd></div>)}</dl>
    {!Object.keys(counts).length && <p>No recorded activity.</p>}
  </section>
}

export default function RoutingOperations() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [clock, setClock] = useState(0)
  const sequence = useRef(0)
  const invalidate = useCallback(() => { sequence.current++ }, [])

  const inspect = useCallback(async () => {
    const generation = ++sequence.current
    setBusy(true); setSnapshot(null); setError('')
    try {
      const response = await fetch('/api/admin/routing/health', { credentials: 'include', cache: 'no-store' })
      if (generation !== sequence.current) return
      if (!response.ok) {
        setError(response.status === 401 || response.status === 403 ? 'Sign in as an administrator to inspect routing operations.' : 'Routing observations are unavailable. Refresh to inspect current state.')
        setMessage(''); return
      }
      const value: Snapshot = await response.json()
      if (generation !== sequence.current) return
      setSnapshot(value); setClock(Date.now())
    } catch {
      if (generation === sequence.current) setError('Routing observations are unavailable. Refresh to inspect current state.')
    } finally { if (generation === sequence.current) setBusy(false) }
  }, [])

  useEffect(() => {
    void inspect()
    const timer = setInterval(() => setClock(Date.now()), 5_000)
    return () => { invalidate(); clearInterval(timer) }
  }, [inspect, invalidate])

  const observationAge = snapshot ? clock - Date.parse(snapshot.checked_at) : Infinity
  const fresh = Number.isFinite(observationAge) && observationAge >= -30_000 && observationAge <= freshnessMs
  const control = snapshot?.admission
  const resumeBlocked = Boolean(control?.paused && (control.source === 'environment' || !snapshot?.financial_health.healthy))

  async function changeAdmission() {
    if (!snapshot || busy || !fresh || resumeBlocked) return
    const currentAge = Date.now() - Date.parse(snapshot.checked_at)
    if (!Number.isFinite(currentAge) || currentAge < -30_000 || currentAge > freshnessMs) { setClock(Date.now()); return }
    const command = { paused: !snapshot.admission.paused, expected_revision: snapshot.admission.revision }
    const generation = ++sequence.current
    setBusy(true); setSnapshot(null); setError(''); setMessage('')
    try {
      const csrf = decodeURIComponent(document.cookie.split('; ').find(value => value.startsWith('csrf-token='))?.slice('csrf-token='.length) || '')
      const response = await fetch('/api/admin/routing/pause', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(command) })
      if (generation !== sequence.current) return
      if (response.status === 401 || response.status === 403 && !csrf) {
        setError('Your administrator session must be refreshed before another command.'); return
      }
      const result = await response.json()
      if (generation !== sequence.current) return
      if (!response.ok) {
        setError(explanations[result.code] || 'The command was rejected. Inspect the current state before issuing another command.'); return
      }
      setMessage(command.paused ? 'Routing pause recorded. Original work, payment proofs, refunds and payouts remain recoverable.' : 'Routing admission resumed. Deployment flags and existing purchasing authority still apply.')
      await inspect()
    } catch {
      if (generation === sequence.current) setError('The command response was lost. Refresh to inspect the original control state before another command. The command will not be repeated automatically.')
    } finally { if (generation === sequence.current) setBusy(false) }
  }

  return <main className={styles.page}>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-3xl font-semibold">Routing operations</h1><p className="mt-3 max-w-2xl">Inspect routing health and control new routed purchases. Original payment recovery, work delivery, buyer review and settlement continue through their existing paths.</p></div>
      <Link href="/dashboard?tab=admin" className="btn-secondary">Back to administration</Link>
    </header>
    <button className="btn-secondary min-h-11" disabled={busy} onClick={() => void inspect()}>{busy ? 'Inspecting…' : 'Refresh routing state'}</button>
    {error && <p role="alert" className="break-words text-red-300">{error}</p>}
    {message && <p role="status" className="break-words">{message}</p>}
    {snapshot && <>
      <p className="text-sm">Observed {time(snapshot.checked_at)}. {!fresh && <strong>Observation expired. Refresh before changing routing.</strong>}</p>
      <section className="card space-y-4" aria-labelledby="admission-title">
        <h2 id="admission-title" className="text-xl font-semibold">New routing admission</h2>
        <p data-testid="routing-admission">{control?.paused ? 'Paused' : 'Accepting authorized requests'} · Revision {control?.revision}</p>
        <p>Source: {label(control!.source)}. Reason: {control?.reason_code ? label(control.reason_code) : 'No hold recorded'}.</p>
        <p>Financial reconciliation: <strong>{snapshot.financial_health.healthy ? 'Healthy' : 'Attention required'}</strong>. Monitor checked: {time(control!.last_checked_at)}.</p>
        {control?.paused && <p className="text-sm">Automatic recovery requires {control.recovery_required_checks} spaced healthy checks over at least {control.recovery_minimum_seconds} seconds. Current samples: {control.healthy_check_count}.</p>}
        {control?.source === 'environment' && <p>An environment hold is active. The console cannot clear it.</p>}
        <button className="btn-secondary min-h-11" disabled={busy || !fresh || resumeBlocked} onClick={() => void changeAdmission()}>{control?.paused ? 'Resume routing admission' : 'Pause new routing'}</button>
      </section>
      <section className="card space-y-3" aria-labelledby="rollout-title">
        <h2 id="rollout-title" className="text-xl font-semibold">Deployment rollout</h2>
        <p>{snapshot.flags.route_execution ? 'Routing execution rollout is enabled.' : 'Routing execution rollout is closed.'} Resuming admission does not change rollout flags or grant purchasing authority.</p>
        <dl className={styles.flags}>{Object.entries(snapshot.flags).map(([name, enabled]) => <div key={name} className="flex flex-wrap gap-3"><dt className="capitalize">{label(name)}</dt><dd>{enabled ? 'Enabled' : 'Closed'}</dd></div>)}</dl>
      </section>
      <section className="card space-y-3" aria-labelledby="alerts-title">
        <h2 id="alerts-title" className="text-xl font-semibold">Routing alerts ({snapshot.alerts.length})</h2>
        {snapshot.alerts.length ? <ul className="space-y-3">{snapshot.alerts.map((alert, index) => <li key={`${alert.code}:${index}`} className="break-words"><strong className="capitalize">{label(String(alert.code))}</strong> · {alert.count} · {alert.severity}</li>)}</ul> : <p>No routing alerts in this observation.</p>}
      </section>
      <div className={styles.metrics}>
        <Counts title="Provider execution" counts={snapshot.provider_execution} />
        <Counts title="Route progress" counts={snapshot.route_progress} />
        <Counts title="Original route funding" counts={snapshot.route_funding} />
        <Counts title="Backed route receipts" counts={snapshot.route_receipts} />
        <Counts title="Account credit anomalies" counts={{ accounts: snapshot.account_credit.account_anomalies, missing_accounts: snapshot.account_credit.missing_accounts,
          deposits: snapshot.account_credit.deposit_anomalies, unsupported_mints: snapshot.account_credit.mint_anomalies,
          instant_sessions: snapshot.account_credit.instant_session_anomalies, instant_calls: snapshot.account_credit.instant_call_anomalies,
          instant_entries: snapshot.account_credit.instant_entry_anomalies }} />
        <Counts title="Recorded routes" counts={snapshot.usage.routes} />
        <Counts title="Recorded orders" counts={snapshot.usage.orders} />
        <Counts title="Webhook outbox" counts={{ retrying: snapshot.outboxes.webhook.retrying_count, failed: snapshot.outboxes.webhook.failed_count, overdue: snapshot.outboxes.webhook.overdue_count }} />
        <Counts title="Settlement outbox" counts={{ failed: snapshot.outboxes.settlement.failed_count, stuck: snapshot.outboxes.settlement.stuck_count }} />
        <Counts title="Verification jobs" counts={snapshot.verification_jobs} />
        <section className="card space-y-3"><h2 className="text-lg font-semibold">Webhook reconciliation worker</h2><p className="capitalize">{label(snapshot.workers.webhooks.status)}</p><p>Last success: {time(snapshot.workers.webhooks.last_succeeded_at)}.</p><p>Last failure: {time(snapshot.workers.webhooks.last_failed_at)}.</p></section>
      </div>
      <details className="card"><summary className="cursor-pointer">Recent schema migrations</summary><ul className="mt-3 space-y-2">{snapshot.migrations.map(migration => <li key={migration.id} className="break-all text-sm">{migration.id}</li>)}</ul></details>
    </>}
  </main>
}
