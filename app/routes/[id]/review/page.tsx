'use client'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { inspectBuyerArtifact } from '@/lib/buyer-review-artifact'
import styles from '@/app/organizations/enterprise.module.css'
import recovery from '../recovery.module.css'
type Lifecycle = Awaited<ReturnType<typeof import('@/lib/route-lifecycle').inspectRouteLifecycle>>
type Result = Awaited<ReturnType<typeof import('@/lib/route-lifecycle').inspectOwnedRouteResult>>
type Snapshot = NonNullable<Awaited<ReturnType<typeof import('@/lib/route-inspection').inspectOwnedRoute>>>
type Verification = { trade_id: string; delivery: Lifecycle['delivery']; acceptance: Lifecycle['acceptance']; categories: Record<string, boolean>;
  artifacts: Array<{ id: string; delivery_id: string | null; sha256: string; media_type: string; size_bytes: number; name: string }>;
  results: Array<{ id: string; delivery_id: string | null; content_hash: string; method: string; status: string; evidence: unknown; failure: string | null }> }
type Review = { id: string; at: number; lifecycle: Lifecycle; result: Result; snapshot: Snapshot; verification: Verification; artifacts: Array<{ id: string; name: string; text: string }> }
const label = (value: string) => value.replaceAll('_', ' ')
export default function BuyerDeliveryReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params), path = `/api/routes/${encodeURIComponent(id)}`
  const [view, setView] = useState<Review | null>(null), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [reading, setReading] = useState(false), [busy, setBusy] = useState(false), [checked, setChecked] = useState(false), [now, setNow] = useState(0)
  const generation = useRef(0), mutation = useRef(false), abort = useRef<AbortController | null>(null)
  const load = useCallback(async () => {
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller
    const current = ++generation.current, timer = setTimeout(() => controller.abort(), 15_000)
    setView(null); setChecked(false); setError(''); setReading(true)
    const read = async <T,>(url: string): Promise<T> => {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal })
      if (!response.ok) throw Error([401,403,404].includes(response.status) ? 'access' : 'unavailable')
      return response.json() as Promise<T>
    }
    try {
      const [snapshot, lifecycle, result] = await Promise.all([read<Snapshot>(path), read<Lifecycle>(path + '/advance'), read<Result>(path + '/result')])
      if (snapshot.route.id !== id || lifecycle.route_id !== id || result.route_id !== id || !lifecycle.delivery || !lifecycle.trade_id
        || lifecycle.trade_id !== result.trade_id || snapshot.route.service_order_id !== lifecycle.order_id
        || lifecycle.delivery.id !== result.delivery.id || lifecycle.delivery.content_hash !== result.delivery.content_hash
        || !/^[a-f0-9]{64}$/.test(result.delivery.content_hash)) throw Error('changed')
      const verification = await read<Verification>(`/api/trades/${encodeURIComponent(result.trade_id)}/verification`)
      const economic = snapshot.attempts.find(attempt => attempt.service_order_id === lifecycle.order_id)?.economic
      if (verification.trade_id !== lifecycle.trade_id || verification.delivery?.id !== result.delivery.id
        || verification.delivery.content_hash !== result.delivery.content_hash || verification.acceptance?.accepted !== lifecycle.acceptance?.accepted
        || economic?.trade_id !== lifecycle.trade_id
        || ['awaiting_buyer', 'settling'].includes(lifecycle.phase) && economic.trade_status !== 'pending_release'
        || lifecycle.phase === 'completed' && (!['completed', 'complete'].includes(economic.trade_status) || economic.payout_status !== 'complete' || !economic.capacity_released_at)
        || result.artifacts.length > 8 || new Set(result.artifacts.map(item => item.id)).size !== result.artifacts.length
        || result.artifacts.reduce((sum, item) => sum + item.size_bytes, 0) > 262_144) throw Error('changed')
      const currentArtifacts = verification.artifacts.filter(item => item.delivery_id === result.delivery.id)
      if (currentArtifacts.length !== result.artifacts.length) throw Error('changed')
      const artifacts = []
      for (const item of result.artifacts) {
        const metadata = currentArtifacts.find(other => other.id === item.id)
        if (!metadata || metadata.sha256 !== item.sha256 || metadata.media_type !== item.media_type || metadata.size_bytes !== item.size_bytes) throw Error('changed')
        artifacts.push({ id: item.id, name: metadata.name, text: await inspectBuyerArtifact(result.trade_id, item, controller.signal) })
      }
      if (current !== generation.current) return false
      const at = Date.now(); setNow(at); setView({ id, at, lifecycle, result, snapshot, verification, artifacts }); return true
    } catch (problem) {
      if (current === generation.current) setError(problem instanceof Error && problem.message === 'access'
        ? 'Sign in with the original buyer account to review this private delivery.'
        : 'Delivery inspection is unavailable or changed. Refresh original state before accepting.')
      return false
    } finally { clearTimeout(timer); if (current === generation.current) setReading(false) }
  }, [id, path])
  useEffect(() => { setMessage(''); void load(); return () => { generation.current += 1; abort.current?.abort() } }, [load])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer) }, [])
  const stale = !!view && now - view.at >= 60_000
  const canAccept = !!view && view.id === id && view.lifecycle.phase === 'awaiting_buyer' && !view.lifecycle.acceptance?.accepted
    && !view.lifecycle.acceptance?.error_code && !view.verification.acceptance?.error_code
  const canRecover = !!view && view.lifecycle.acceptance?.accepted && (view.lifecycle.phase === 'settling' || view.lifecycle.phase === 'completed' && !view.lifecycle.receipt)
  async function command(action: 'accept' | 'observe') {
    if (mutation.current || !view || view.id !== id || reading || (action === 'accept' ? !canAccept || !checked : !canRecover)) return
    if (Date.now() - view.at >= 60_000) { setChecked(false); setNow(Date.now()); return }
    const contentHash = view.result.delivery.content_hash, current = ++generation.current
    mutation.current = true; setBusy(true); setView(null); setChecked(false); setError(''); setMessage('')
    try {
      const csrf = decodeURIComponent(document.cookie.split('; ').find(cookie => cookie.startsWith('csrf-token='))?.slice(11) || '')
      const response = await fetch(path + '/advance', { method: 'POST', credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(action === 'accept' ? { version: 1, action, content_hash: contentHash } : { version: 1, action }) })
      if (current !== generation.current) return
      if (!response.ok) { setError(response.status === 409 ? 'Delivery or settlement changed. Refresh original state before another decision.'
        : [401,403,404].includes(response.status) ? 'Original buyer access and CSRF are required. Refresh original state.'
        : 'Acceptance was not confirmed. Refresh original state; the original decision may have committed.'); return }
      if (await load()) setMessage('Original command acknowledged. Inspect the original payout and backed receipt below.')
    } catch { if (current === generation.current) setError('The response was lost. Acceptance may have committed. Refresh original state; do not repeat the decision.') }
    finally { mutation.current = false; setBusy(false) }
  }
  return <main className={`${styles.page} ${styles.workspace} ${recovery.page}`}>
    <header><h1>Private buyer delivery review</h1><p>Review the original output and verification before accepting the exact delivery.</p></header>
    <div className={styles.links}><Link href={`/routes/${encodeURIComponent(id)}`}>Original route recovery</Link><button disabled={reading || busy} onClick={() => { setMessage(''); void load() }}>Refresh original state</button></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{reading && <p role="status">Inspecting private delivery and artifact integrity…</p>}
    {stale && <p role="alert">Inspection expired. Refresh original state before accepting.</p>}
    {view && view.id === id && <>
      <section><h2>Original delivery</h2><p>{view.snapshot.route.objective}</p><p>Route {id} · Order {view.lifecycle.order_id} · Trade {view.result.trade_id}</p>
        <p>Delivery {view.result.delivery.id}</p><p>Exact delivery hash {view.result.delivery.content_hash}</p><p>Result fingerprint {view.result.result_hash}</p>
        <pre>{view.result.content.summary}</pre><pre>{JSON.stringify(view.result.content.artifact, null, 2)}</pre>
        {view.result.content.delivery_url && <p>Provider-declared delivery URL (not retrieved): {view.result.content.delivery_url}</p>}
        <p>Inspected {new Date(view.at).toLocaleTimeString()}. Provider output and declared URLs are untrusted content.</p>
      </section>
      <section><h2>Verification for this delivery</h2><p>Recorded acceptance: {view.lifecycle.acceptance?.accepted ? 'accepted' : 'not accepted'} · Mode {label(view.lifecycle.acceptance?.mode || 'unknown')}</p>
        <p>Checks report the recorded evidence. Semantic truth, provenance, benchmarks and observed isolation remain unverified.</p>
        <pre>{JSON.stringify(view.verification.categories, null, 2)}</pre>
        {view.verification.results.filter(check => check.delivery_id === view.result.delivery.id && check.content_hash === view.result.delivery.content_hash).map(check => <details key={check.id}>
          <summary>{label(check.method)} · {check.status}</summary><pre>{JSON.stringify({ evidence: check.evidence, failure: check.failure }, null, 2)}</pre></details>)}
      </section>
      <section><h2>Private artifacts</h2>{view.artifacts.length ? view.artifacts.map(item => <details key={item.id}><summary>{item.name} · size and SHA-256 checked</summary>
        <p>Artifact {item.id}</p><pre>{item.text}</pre></details>) : <p>No private artifact is attached to this delivery.</p>}
        <p>Text and JSON appear as plain text. Binary files show checked size and hash.</p></section>
      <section><h2>Exact buyer decision</h2>{canAccept ? <><p>Accepting releases the original escrow through the existing settlement process. Required verification is checked again by the server.</p>
        <label className={recovery.check}><input type="checkbox" checked={checked} disabled={reading || busy || stale} onChange={event => setChecked(event.target.checked)} />I reviewed this exact delivery and authorize release of its original escrow.</label>
        <button disabled={!checked || reading || busy || stale} onClick={() => void command('accept')}>Accept exact original delivery</button>
      </> : <p>This observation does not permit a new acceptance decision. Recover the original settlement or use existing trade controls.</p>}</section>
      <section><h2>Original settlement</h2><p>Work phase: {label(view.lifecycle.phase)} · Funds: {label(view.lifecycle.funds_state)}</p>
        <p>Server recovery action: {label(view.lifecycle.next_action)}</p>
        {view.snapshot.attempts.filter(attempt => attempt.service_order_id === view.lifecycle.order_id).map(attempt => <div key={attempt.id}>
          <p>Capacity {attempt.economic?.capacity_released_at ? 'released' : 'held'}</p>
          <pre>{JSON.stringify({ payment_receipt: attempt.economic?.payment_receipt, transfers: attempt.economic?.transfers }, null, 2)}</pre></div>)}
        {view.lifecycle.receipt ? <details><summary>Original backed route receipt</summary><pre>{JSON.stringify(view.lifecycle.receipt, null, 2)}</pre></details>
          : <p>No backed route receipt is recorded. A buyer decision or submitted payout alone does not prove completion.</p>}
        {canRecover && <button disabled={reading || busy || stale} onClick={() => void command('observe')}>Recover original accepted settlement</button>}
      </section><Link href="/dashboard?tab=trades">Open existing trade controls</Link>
    </>}
  </main>
}
