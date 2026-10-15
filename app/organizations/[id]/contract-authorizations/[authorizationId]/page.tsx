'use client'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { OrganizationContractAuthorization, OrganizationContractDecision } from '@/sdk/typescript/src/index'
import styles from '@/app/organizations/enterprise.module.css'

const usd = (minor: number) => `$${(minor / 100).toFixed(2)} USD`
const utc = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : 'Not set'
export default function OrganizationContractReview({ params }: { params: Promise<{ id: string; authorizationId: string }> }) {
  const { id, authorizationId } = use(params), path = `/api/organizations/${encodeURIComponent(id)}/contract-authorizations/${encodeURIComponent(authorizationId)}`
  const [review, setReview] = useState<OrganizationContractAuthorization | null>(null), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [observed, setObserved] = useState(0)
  const generation = useRef(0), working = useRef(false), decision = useRef<OrganizationContractDecision | null>(null)
  const key = `clawdmarket-contract-review:${id}:${authorizationId}`
  const load = useCallback(async () => {
    const current = ++generation.current; setReview(null); setConfirmed(false); setMessage('')
    try {
      const response = await fetch(path, { credentials: 'include', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) })
      if (!response.ok) throw Error([401, 403, 404].includes(response.status) ? 'Sign in as the current owner or selected reviewer to inspect this private contract.' : 'Inspection is unavailable. Refresh before making a decision.')
      const { authorization: a } = await response.json() as { authorization: OrganizationContractAuthorization }
      const t = a?.terms, o = t?.original
      if (a?.id !== authorizationId || a.organization_id !== id || a.version !== 1 || !['owner', 'reviewer'].includes(a.viewer_role)
        || !['pending', 'approved', 'revoked'].includes(a.state) || !/^[a-f0-9]{64}$/.test(a.authority_hash) || t?.version !== 1
        || o?.contract_id !== a.contract_id || o?.buyer_id !== a.buyer_id || t?.explicit_buyer_acceptance !== true || t.automatic_review_window_acceptance !== false
        || t.payment?.rail !== 'credit' || t.payment.redeemable !== false || t.payment.seller_receives !== 'nonwithdrawable_account_credit'
        || !Number.isFinite(Date.parse(t.expires_at)) || !Array.isArray(o.milestones) || !o.milestones.length || o.milestones.length > 20
        || o.milestones.some((m, index) => m.milestone_index !== index || !Number.isSafeInteger(m.amount_minor) || m.amount_minor < 1)
        || new Set(o.milestones.map(m => m.id)).size !== o.milestones.length || o.milestones.reduce((sum, m) => sum + m.amount_minor, 0) !== o.total_minor
        || o.total_minor + o.fee_minor !== o.gross_minor || t.payment.upfront_fee_minor !== o.fee_minor || t.payment.refundable_principal_minor !== o.total_minor) throw Error('The original contract review is unavailable or changed.')
      if (current === generation.current) { setReview(a); setObserved(Date.now()); setError('') }
    } catch (cause) { if (current === generation.current) { setReview(null); setError(cause instanceof Error ? cause.message : 'Inspection unavailable.') } }
  }, [path, id, authorizationId])
  const invalidate = useCallback(() => { generation.current++ }, [])
  useEffect(() => { decision.current = null; void load(); return invalidate }, [load, invalidate])
  useEffect(() => {
    const clear = () => { generation.current++; setReview(null); setConfirmed(false); decision.current = null; setMessage(''); setError('Refresh and sign in to inspect the original review.') }
    const visibility = () => { if (document.hidden) clear() }
    window.addEventListener('focus', clear); window.addEventListener('blur', clear); document.addEventListener('visibilitychange', visibility)
    const timer = setTimeout(() => { generation.current++; setReview(null); setConfirmed(false); setMessage('Review expired. Refresh current state before deciding.') }, 60000)
    return () => { clearTimeout(timer); window.removeEventListener('focus', clear); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', visibility) }
  }, [observed])
  const mutate = async (approve: boolean) => {
    if (!review || working.current || Date.now() - observed >= 60000 || approve && !confirmed) return
    const original = review, current = ++generation.current
    working.current = true; setBusy(true); setError(''); setMessage('')
    try {
      let body: OrganizationContractDecision | undefined
      if (approve) {
        let saved = decision.current
        if (!saved) { const source = sessionStorage.getItem(key); if (source) saved = JSON.parse(source) as OrganizationContractDecision }
        if (saved && (Object.keys(saved).length !== 4 || Object.keys(saved).some(field => !['version', 'client_reference', 'authority_hash', 'approve'].includes(field))
          || saved.version !== 1 || saved.approve !== true || saved.authority_hash !== original.authority_hash || !/^[A-Za-z0-9._:-]{8,128}$/.test(saved.client_reference))) throw Error('The original saved decision differs. Inspect its status before continuing.')
        body = saved ?? { version: 1, client_reference: crypto.randomUUID(), authority_hash: original.authority_hash, approve: true }
        sessionStorage.setItem(key, JSON.stringify(body)); decision.current = body
      }
      const csrf = decodeURIComponent(document.cookie.split('; ').find(cookie => cookie.startsWith('csrf-token='))?.slice(11) || '')
      const response = await fetch(path + (approve ? '/approval' : ''), { method: approve ? 'POST' : 'DELETE', credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(body ? { body: JSON.stringify(body) } : {}) })
      if (current !== generation.current) return
      if (!response.ok) throw Error('The decision was not confirmed. Refresh the original review; retain the saved reference.')
      const result = await response.json() as { authorization: OrganizationContractAuthorization }
      if (current !== generation.current) return
      if (result.authorization?.id !== original.id || result.authorization.authority_hash !== original.authority_hash) throw Error('Original contract identity did not match. Refresh before continuing.')
      await load(); setMessage(result.authorization.state === 'revoked' ? 'Fresh contract funding is revoked. Original paid work, decisions, refunds and credit postings remain recoverable.' : 'Original contract approval recorded. Buyer funding, exact output acceptance and credit release remain separate.')
    } catch (cause) {
      if (current === generation.current) { setReview(null); setConfirmed(false); setError(cause instanceof Error && !(cause instanceof TypeError) && !(cause instanceof DOMException) ? cause.message : 'Response unavailable. Refresh the original review before continuing.') }
    } finally { working.current = false; setBusy(false) }
  }
  const terms = review?.terms, original = terms?.original, expired = !!terms && Date.parse(terms.expires_at) <= Date.now()
  return <main className={`${styles.page} ${styles.workspace}`}>
    <Link href={`/organizations/${encodeURIComponent(id)}`}>Organization workspace</Link>
    <h1>Review organization contract</h1>
    <p>The owner proposes one original agreement. The selected organizational reviewer checks its frozen milestones and payment limits. This role separation does not establish marketplace ownership independence.</p>
    <button disabled={busy} onClick={() => void load()}>Refresh original review</button>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {review && terms && original && <>
      <section aria-label="Original contract"><h2>Original contract</h2><p>Status: {review.state}{expired ? ' · expired' : ''}</p>
        <dl>{[['Contract', original.contract_id], ['Seller', original.seller_id], ['Assigned buyer', original.buyer_id], ['Listing', original.listing_id ?? 'No linked listing'],
          ['Department', `${review.team_id ?? 'Organization'} · ${review.cost_center}`], ['Review expires (UTC)', utc(terms.expires_at)], ['Original draft expires (UTC)', utc(original.expires_at)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p>Pending review takes no funds or inventory reservation. Approval cannot replace this agreement or renew its original deadlines.</p>
      </section>
      <section aria-label="Original milestones"><h2>Original milestones</h2>
        {original.milestones.map(m => <article key={m.id}><h3>{m.milestone_index + 1}. {m.title}</h3><p>{usd(m.amount_minor)} · Deadline (UTC): {utc(m.deadline_at)} · Review window: {m.review_window_hours} hours</p>
          <p>Milestone: {m.id}</p><p>Acceptance specification: {JSON.stringify(m.acceptance_spec)}</p></article>)}
        <p>Seller output stays private to the original buyer and seller. Required-key checks do not measure semantic accuracy or prove remote execution. The buyer must accept one exact submission ID and hash. Review-window expiry does not accept reviewed work or release credit.</p>
      </section>
      <section aria-label="Credit settlement terms"><h2>Credit settlement terms</h2>
        <p>Prepaid credit is nonwithdrawable. Sellers receive nonwithdrawable account credit, not external tokens. Depositing funds does not make them redeemable.</p>
        <dl>{[['Principal', usd(original.total_minor)], ['Upfront fee', usd(original.fee_minor)], ['Total reserved credit', usd(original.gross_minor)],
          ['Daily / monthly / lifetime gross ceilings', `${usd(terms.max_daily_minor)} / ${usd(terms.max_monthly_minor)} / ${usd(terms.max_lifetime_minor)}`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p>Unstarted refunds return original principal and retain the original fee. Refunded or cancelled orders do not replenish original gross exposure or reopen consumed inventory. Exact buyer acceptance and confirmed credit release are separate records.</p>
        <p>{review.funding_available ? 'Fresh funding requires the original buyer command and current review, rail and budget checks.' : 'Fresh funding rollout is disabled.'} Organizational review cannot fund an order.</p>
      </section>
      {review.state === 'pending' && review.viewer_role === 'reviewer' && !expired && <section aria-label="Selected reviewer approval">
        <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />I reviewed the original milestones, deadlines, exact quote, nonwithdrawable credit and payment limits.</label>
        <button disabled={busy || !confirmed} onClick={() => void mutate(true)}>Approve original contract</button>
      </section>}
      {review.state === 'pending' && review.viewer_role === 'owner' && <p>The selected organizational reviewer must approve this proposal.</p>}
      {review.state !== 'revoked' && <button disabled={busy} onClick={() => void mutate(false)}>Revoke fresh funding</button>}
    </>}
  </main>
}
