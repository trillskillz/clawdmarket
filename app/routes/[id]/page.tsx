'use client'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import styles from '@/app/organizations/enterprise.module.css'
import recovery from './recovery.module.css'
type Snapshot = NonNullable<Awaited<ReturnType<typeof import('@/lib/route-inspection').inspectOwnedRoute>>>
type Lifecycle = Awaited<ReturnType<typeof import('@/lib/route-lifecycle').inspectRouteLifecycle>>
type Retry = Awaited<ReturnType<typeof import('@/lib/route-funded-retry').inspectFundedRouteRetry>>
type Observation = { id: string; snapshot: Snapshot; lifecycle: Lifecycle; retry: Retry; at: number }
const label = (value: string) => value.replaceAll('_', ' ')
const money = (minor: number) => `$${(minor / 100).toFixed(2)} USD`
const reconciliationReasons: Record<string, string> = {
  ROUTE_RETRY_LINK_INVARIANT: 'No complete original retry authority and payment linkage is recorded',
  ROUTE_RETRY_PAYMENT_UNKNOWN: 'The original payment remains unknown',
  ROUTE_RETRY_FUNDING_EVIDENCE_MISSING: 'Exact original funding proof is unavailable',
  ROUTE_RETRY_RECONCILIATION_REQUIRED: 'Original work and its refund require reconciliation',
  ROUTE_RETRY_PAYOUT_CONFLICT: 'The original refund conflicts with recorded seller payout',
  ROUTE_RETRY_REFUND_EVIDENCE_MISSING: 'Exact original refund evidence is not confirmed',
  ROUTE_RETRY_WALLET_PAYMENT_UNRECONCILED: 'The original wallet payment remains unreconciled',
}
const reconciliationReason = (code: string | null) => reconciliationReasons[code || ''] || 'Original retry reconciliation is unavailable'
function eligible(view: Observation) {
  const { route, attempts } = view.snapshot, current = attempts.find(attempt => attempt.service_order_id === route.service_order_id)?.economic
  return route.state === 'planned' && !route.service_order_id && !view.lifecycle.trade_id && !attempts.some(attempt => attempt.economic)
    || route.state === 'awaiting_funding' && view.lifecycle.phase === 'awaiting_funding' && current?.trade_status === 'pending'
}
export default function BuyerRouteRecovery({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params), path = `/api/routes/${encodeURIComponent(id)}`
  const [view, setView] = useState<Observation | null>(null), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [checked, setChecked] = useState(false), [reading, setReading] = useState(false), [busy, setBusy] = useState(false), [now, setNow] = useState(0)
  const generation = useRef(0), mutation = useRef(false)
  const load = useCallback(async () => {
    const current = ++generation.current
    setView(null); setReading(true); setChecked(false); setError('')
    try {
      const responses = await Promise.all(['', '/advance', '/retry'].map(suffix => fetch(path + suffix, { credentials: 'include', cache: 'no-store' })))
      if (responses.some(response => !response.ok)) {
        if (current === generation.current) setError(responses.some(response => [401,403,404].includes(response.status))
          ? 'Sign in with the original buyer account to inspect this route.' : 'Route inspection is unavailable. Refresh original state before another command.')
        return false
      }
      const [snapshot, lifecycle, retry] = await Promise.all([responses[0].json() as Promise<Snapshot>, responses[1].json() as Promise<Lifecycle>, responses[2].json() as Promise<Retry>])
      const currentTrade = snapshot.attempts.find(attempt => attempt.service_order_id === snapshot.route.service_order_id)?.economic?.trade_id || null
      if (snapshot.route.id !== id || lifecycle.route_id !== id || retry.route_id !== id
        || snapshot.route.service_order_id !== lifecycle.order_id || lifecycle.trade_id !== retry.trade_id || lifecycle.trade_id !== currentTrade) throw Error('changed observation')
      if (current !== generation.current) return false
      const at = Date.now(); setNow(at); setView({ id, snapshot, lifecycle, retry, at }); return true
    } catch { if (current === generation.current) setError('Route inspection is unavailable or changed during inspection. Refresh original state before another command.'); return false }
    finally { if (current === generation.current) setReading(false) }
  }, [id, path])
  useEffect(() => { setMessage(''); void load(); return () => { generation.current += 1 } }, [load])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer) }, [])
  const stale = !!view && now - view.at >= 60_000
  async function cancel() {
    if (mutation.current || !view || view.id !== id || !checked || !eligible(view)) return
    if (Date.now() - view.at >= 60_000) { setChecked(false); setNow(Date.now()); return }
    const body = JSON.stringify({ expected_service_order_id: view.snapshot.route.service_order_id }), current = ++generation.current
    mutation.current = true; setBusy(true); setView(null); setChecked(false); setError(''); setMessage('')
    try {
      const csrf = decodeURIComponent(document.cookie.split('; ').find(cookie => cookie.startsWith('csrf-token='))?.slice(11) || '')
      const response = await fetch(path, { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body })
      if (current !== generation.current) return
      if (!response.ok) { setError(response.status === 409 ? 'The original checkout changed or funds were committed. Refresh original state before another command.'
        : [401,403,404].includes(response.status) ? 'Original buyer access is required. Refresh to inspect your access.'
        : 'Cancellation was not confirmed. Refresh original state before another command.'); return }
      if (await load()) setMessage('Original unpaid reservation cancelled. Any payment already sent still requires original recovery.')
    } catch { if (current === generation.current) setError('The response was lost. Cancellation may have committed. Refresh original state before another command.') }
    finally { mutation.current = false; setBusy(false) }
  }
  const snapshot = view?.snapshot, lifecycle = view?.lifecycle, canCancel = !!view && eligible(view)
  const disabled = busy || reading || stale || !view
  return <main className={`${styles.page} ${styles.workspace} ${recovery.page}`}>
    <header><h1>Buyer route recovery</h1><p>Inspect the original route and every attempt before changing an unpaid reservation.</p></header>
    <div className={styles.links}><Link href="/dashboard?tab=route-recovery">Back to Route Recovery</Link><button disabled={busy || reading} onClick={() => { setMessage(''); void load() }}>Refresh original state</button></div>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}{reading && <p role="status">Inspecting original route…</p>}
    {stale && <p role="alert">Inspection expired. Refresh original state before another command.</p>}
    {view && view.id === id && <>
      <section><h2>Original route</h2><p>Route {id} · {label(snapshot!.route.state)}</p><p>Stable reference {snapshot!.route.client_reference}</p>
        <p>{snapshot!.route.objective}</p><p>Capabilities {snapshot!.route.required_capabilities.join(', ')}</p>
        <p>Budget {snapshot!.route.max_budget.amount} {snapshot!.route.max_budget.currency} · Deadline {snapshot!.route.deadline_seconds === null ? 'No recorded limit' : `${snapshot!.route.deadline_seconds} seconds`}</p>
        <p>Inspected {new Date(view.at).toLocaleTimeString()}</p>
        <details><summary>Exact saved inputs, policies and provider choices</summary><pre>{JSON.stringify({ input: snapshot!.route.input, verification: snapshot!.route.verification,
          payment_policy: snapshot!.route.payment_policy, retry_policy: snapshot!.route.retry_policy, provider_requirements: snapshot!.route.provider_requirements, candidates: snapshot!.route.candidates }, null, 2)}</pre></details>
      </section>
      <section><h2>Current work and payment</h2><p>Work phase: {label(lifecycle!.phase)}</p><p>Recorded funds state: {label(lifecycle!.funds_state)}</p>
        {snapshot!.payment_exposure ? <><p>Payment exposure: {label(snapshot!.payment_exposure.state)}</p>
          <p>{snapshot!.payment_exposure.late_payment_possible ? 'An original payment may arrive late. Cancellation cannot prove that no payment was sent.' : 'Inspect recorded payment and settlement evidence for the original trade.'}</p></>
          : <p>No original checkout is recorded. Planning alone moves no funds.</p>}
        <p>Original order {lifecycle!.order_id ?? 'None recorded'} · Original trade {lifecycle!.trade_id ?? 'None recorded'}</p>
        <p>Recovery action recorded by the server: {label(lifecycle!.next_action)}.</p>
        {snapshot!.provider_execution && <details><summary>Original provider execution and deadlines</summary><pre>{JSON.stringify({ provider: snapshot!.provider_execution, timing: snapshot!.execution_timing }, null, 2)}</pre></details>}
        {lifecycle!.receipt && <details><summary>Original backed route receipt</summary><pre>{JSON.stringify(lifecycle!.receipt, null, 2)}</pre></details>}
        {view.retry.reconciliation && <p>Original retry reconciliation: {view.retry.reconciliation.reconciled ? 'Confirmed original refund' : reconciliationReason(view.retry.reconciliation.blocking_reason)}. This observation grants no new purchase.</p>}
        <p>Reconcile each original attempt before considering another purchase. A refund for one attempt does not settle another.</p>
      </section>
      <section><h2>All original attempts</h2>{snapshot!.attempts.length ? <div className={recovery.attempts}>{snapshot!.attempts.map(attempt => <article key={attempt.id}>
        <h3>Attempt {attempt.attempt_number}</h3><p>Attempt {attempt.id} · Service {attempt.service_id} · {label(attempt.state)}</p>
        {attempt.failure_code && <p>Recorded failure: {attempt.failure_code} · {attempt.failure_category && label(attempt.failure_category)}</p>}
        {attempt.economic ? <><p>Original order {attempt.service_order_id} · Trade {attempt.economic.trade_id}</p>
          <p>Gross buyer amount {money(attempt.economic.amount_minor)} · Trade {label(attempt.economic.trade_status)} · Payout {label(attempt.economic.payout_status)}</p>
          <p>Capacity {attempt.economic.capacity_released_at ? 'released' : 'held'}{attempt.economic.capacity_released_at && ` at ${new Date(attempt.economic.capacity_released_at).toLocaleString()}`}</p>
          <p>Original payment intent {attempt.economic.payment_intent_id ?? 'None recorded'} · Funding step {attempt.economic.funding_step_id ?? 'None recorded'}</p>
          {attempt.economic.payment_receipt ? <><p>Original payment receipt {attempt.economic.payment_receipt.id}</p><p>Payment hash {attempt.economic.payment_receipt.tx_hash ?? 'Not recorded'} · Token amount {attempt.economic.payment_receipt.token_amount ?? 'Unknown'} base units</p></>
            : <p>No recorded payment receipt. An external payment may still be unknown or arrive late.</p>}
          {attempt.economic.transfers.length ? <ul>{attempt.economic.transfers.map(transfer => <li key={transfer.id}>{label(transfer.kind)} · {transfer.status} · Transfer {transfer.id} · {transfer.token_amount} token base units · Hash {transfer.tx_hash ?? 'Unknown'} · Confirmation {transfer.confirmed_at ? new Date(transfer.confirmed_at).toLocaleString() : 'Not recorded'}</li>)}</ul>
            : <p>No settlement transfer is recorded for this attempt.</p>}
        </> : <p>No economic order is recorded for this candidate attempt.</p>}
      </article>)}</div> : <p>No attempts are recorded.</p>}</section>
      <section><h2>Original unpaid cancellation</h2>{canCancel ? <>
        <p>Cancellation targets {snapshot!.route.service_order_id ? `original order ${snapshot!.route.service_order_id}` : 'this original plan without a checkout'}. The server rejects changed targets and funded work.</p>
        <label className={recovery.check}><input type="checkbox" checked={checked} disabled={disabled} onChange={event => setChecked(event.target.checked)} />I understand cancellation cannot stop an already sent payment.</label>
        <button disabled={disabled || !checked} onClick={() => void cancel()}>Cancel original unpaid reservation</button>
      </> : <p>This observation does not permit unpaid cancellation. Preserve the original work and reconcile its payment or settlement.</p>}</section>
      <div className={styles.links}><Link href="/dashboard?tab=trades">Open existing trade controls</Link></div>
      <p>Use the original trade IDs above for existing payment proof, delivery, buyer review, dispute and refund/payout recovery. This page does not sign or send payment, reserve replacement work, retry a purchase or accept delivery.</p>
    </>}
  </main>
}
