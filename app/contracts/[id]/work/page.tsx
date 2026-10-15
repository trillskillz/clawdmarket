'use client'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { OriginalContractCreation, OriginalContractSubmission, OriginalContractAcceptance, OriginalContractCreditRelease } from '@/sdk/typescript/src/index'
import { canonicalJSON } from '@/scripts/verifier-contract.mjs'
import styles from '@/app/organizations/enterprise.module.css'
import workStyles from '@/app/trades/[id]/listing-work/work.module.css'

type View = { contract: OriginalContractCreation['contract'] & { reviewed_contract: boolean }; milestones: OriginalContractCreation['milestones']
  viewer: { is_buyer: boolean; is_seller: boolean }; work: OriginalContractSubmission[]; at: number
  decisions: Record<string, OriginalContractAcceptance>; releases: Record<string, OriginalContractCreditRelease> }
type Command = { version: 1; client_reference: string; submission_id: string; content_hash: string; approve?: true; acceptance_id?: string }
const reference = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value)
const fingerprint = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
const usd = (minor: number) => `$${(minor / 100).toFixed(2)} USD`
async function digest(value: unknown) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJSON(value))))).map(v => v.toString(16).padStart(2, '0')).join('') }
function artifacts(text: string): Record<string, unknown> {
  if (new TextEncoder().encode(text).byteLength > 48000) throw Error('Output exceeds the private workspace limit.')
  const value = JSON.parse(text), stack = [{ value, depth: 0 }]; let nodes = 0
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Enter one JSON object for the artifact bundle.')
  while (stack.length) {
    const item = stack.pop()!
    if (++nodes > 4096 || item.depth > 12 || typeof item.value === 'number' && !Number.isFinite(item.value)) throw Error('Output exceeds the finite input limits.')
    if (item.value && typeof item.value === 'object') for (const child of Object.values(item.value)) stack.push({ value: child, depth: item.depth + 1 })
  }
  return value
}

export default function OriginalContractWork({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params), path = `/api/contracts/${encodeURIComponent(id)}`
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [keyInput, setKeyInput] = useState(''), [checked, setChecked] = useState<Record<string, boolean>>({}), [output, setOutput] = useState<Record<string, string>>({})
  const [acceptanceReference, setAcceptanceReference] = useState<Record<string, string>>({})
  const credential = useRef(''), generation = useRef(0), working = useRef(false), controller = useRef<AbortController | null>(null)
  const storage = (kind: string, milestone: string, submission: string) => `clawdmarket-contract-work:${id}:${milestone}:${submission}:${kind}`
  const clear = useCallback(() => { generation.current++; controller.current?.abort(); setView(null); setChecked({}); setOutput({}); setAcceptanceReference({}) }, [])
  const api = useCallback(async (endpoint: string, signal: AbortSignal, method = 'GET', body?: unknown, missingCode?: string) => {
    signal.throwIfAborted()
    const key = credential.current, csrf = decodeURIComponent(document.cookie.split('; ').find(c => c.startsWith('csrf-token='))?.slice(11) || '')
    const response = await fetch(endpoint, { method, cache: 'no-store', redirect: 'error', credentials: key ? 'omit' : 'include', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let size = 0
    if (!reader) throw Error('Original record unavailable.')
    let value: any
    try {
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 262144) throw Error('Original record exceeds the workspace limit.'); chunks.push(part.value) }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      value = JSON.parse(new TextDecoder().decode(bytes))
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    signal.throwIfAborted()
    if (response.status === 404 && missingCode && value.code === missingCode) return null
    if (!response.ok) throw Error([401, 403, 404].includes(response.status) ? 'Original participant access or this original record is unavailable. Refresh using the original account or agent credential.' : 'Original record or command is unavailable. Retain the saved reference and refresh before continuing.')
    return value
  }, [])
  const load = useCallback(async () => {
    clear(); const current = ++generation.current, abort = new AbortController(); controller.current = abort; setError(''); setMessage('')
    try {
      const data = await api(path, abort.signal)
      if (data.contract?.id !== id || typeof data.viewer?.is_buyer !== 'boolean' || typeof data.viewer?.is_seller !== 'boolean'
        || data.viewer.is_buyer === data.viewer.is_seller || data.contract.reviewed_contract !== true || !Array.isArray(data.milestones)
        || !data.milestones.length || data.milestones.length > 20) throw Error('This workspace requires an original reviewed agreement and participant access.')
      const work: OriginalContractSubmission[] = [], decisions: View['decisions'] = {}, releases: View['releases'] = {}
      if (data.contract.state !== 'DRAFT') for (const m of data.milestones) {
        const base = `${path}/milestones/${encodeURIComponent(m.id)}`, w: OriginalContractSubmission = await api(base, abort.signal)
        if (w.contract_id !== id || w.contract_state !== data.contract.state || w.milestone_id !== m.id || w.milestone_state !== m.state || w.selected_submission_id !== m.submission_id
          || w.settlement_terms?.rail !== 'credit' || w.settlement_terms.redeemable !== false || w.settlement_terms.seller_receives !== 'nonwithdrawable_account_credit'
          || w.submission && (w.submission.id !== w.selected_submission_id || !fingerprint(w.submission.content_hash) || w.submission.authorizes_payment !== false
            || w.submission.semantic_accuracy !== 'unmeasured' || w.submission.remote_execution_observed !== false)) throw Error('Original work changed. Refresh before continuing.')
        work.push(w)
        if (w.submission) {
          const acceptance = sessionStorage.getItem(`clawdmarket-contract-work:${id}:${m.id}:${w.submission.id}:accept`)
          if (acceptance) {
            const saved: Command = JSON.parse(acceptance)
            if (!reference(saved.client_reference) || saved.submission_id !== w.submission.id || saved.content_hash !== w.submission.content_hash || saved.approve !== true) throw Error('Saved original acceptance differs. Retain its reference and inspect before continuing.')
            const d: OriginalContractAcceptance | null = await api(`${base}?acceptance_reference=${encodeURIComponent(saved.client_reference)}`, abort.signal, 'GET', undefined, 'CONTRACT_ACCEPTANCE_NOT_FOUND')
            if (d && (!uuid(d.decision.id) || d.decision.kind !== 'explicit_buyer_acceptance' || d.decision.contract_id !== id || d.decision.milestone_id !== m.id || d.decision.submission_id !== saved.submission_id || d.decision.content_hash !== saved.content_hash
              || d.decision.client_reference !== saved.client_reference || d.decision.buyer_id !== data.contract.buyer_id || d.financial_release_performed !== false)) throw Error('Original acceptance identity changed.')
            if (d) decisions[m.id] = d
          }
          const release = sessionStorage.getItem(`clawdmarket-contract-work:${id}:${m.id}:${w.submission.id}:release`)
          if (release) {
            const saved: Command = JSON.parse(release)
            if (!reference(saved.client_reference) || saved.submission_id !== w.submission.id || saved.content_hash !== w.submission.content_hash) throw Error('Saved original release differs.')
            const r: OriginalContractCreditRelease | null = await api(`${base}?release_reference=${encodeURIComponent(saved.client_reference)}`, abort.signal, 'GET', undefined, 'CONTRACT_RELEASE_NOT_FOUND')
            if (r && (!uuid(r.release.id) || !uuid(r.release.settlement_entry_id) || !uuid(r.release.sale_entry_id) || r.release.basis !== 'explicit_buyer_acceptance'
              || r.release.rail !== 'credit' || r.release.seller_receives !== 'nonwithdrawable_account_credit' || r.release.contract_id !== id || r.release.milestone_id !== m.id || r.release.submission_id !== saved.submission_id || r.release.content_hash !== saved.content_hash
              || r.release.client_reference !== saved.client_reference || r.release.acceptance_id !== saved.acceptance_id || r.financial_posting_confirmed !== true)) throw Error('Original credit posting identity changed.')
            if (r) releases[m.id] = r
          }
        }
      }
      if (current === generation.current) { setView({ ...data, work, decisions, releases, at: Date.now() }); setError('') }
    } catch (cause) { if (current === generation.current) { setView(null); setError(cause instanceof Error && !(cause instanceof TypeError) && !(cause instanceof DOMException) ? cause.message : 'Response unavailable. Refresh the original state before continuing.') } }
  }, [api, clear, path, id])
  useEffect(() => { void load(); return clear }, [load, clear])
  useEffect(() => {
    const invalidate = () => { clear(); credential.current = ''; setKeyInput(''); setError('Private view cleared. Inspect the original state again before continuing.') }
    const visibility = () => { if (document.hidden) invalidate() }
    window.addEventListener('blur', invalidate); window.addEventListener('focus', invalidate); document.addEventListener('visibilitychange', visibility)
    const timer = setTimeout(invalidate, 60000)
    return () => { clearTimeout(timer); window.removeEventListener('blur', invalidate); window.removeEventListener('focus', invalidate); document.removeEventListener('visibilitychange', visibility) }
  }, [clear, view?.at])
  async function mutate(kind: 'start' | 'submit' | 'accept' | 'release' | 'recover', w?: OriginalContractSubmission) {
    if (!view || working.current || Date.now() - view.at >= 60000) return
    const original = view, current = ++generation.current, abort = new AbortController(); controller.current?.abort(); controller.current = abort
    working.current = true; setBusy(true); setError(''); setMessage('')
    try {
      if (kind === 'start') {
        if (!original.viewer.is_seller || original.contract.state !== 'FUNDED' || !checked.start) throw Error('Review the original credit terms before starting.')
        await api(path, abort.signal, 'PATCH', { action: 'start' })
      } else {
        if (!w || !w.milestone_id) throw Error('Inspect the original milestone first.')
        const base = `${path}/milestones/${encodeURIComponent(w.milestone_id)}`
        if (kind === 'recover') {
          const saved = acceptanceReference[w.milestone_id]
          if (!original.viewer.is_buyer || !reference(saved) || !w.submission) throw Error('Enter the saved original acceptance reference.')
          const d: OriginalContractAcceptance = await api(`${base}?acceptance_reference=${encodeURIComponent(saved)}`, abort.signal)
          if (d.decision.contract_id !== id || d.decision.milestone_id !== w.milestone_id || d.decision.submission_id !== w.submission.id || d.decision.content_hash !== w.submission.content_hash
            || d.decision.buyer_id !== original.contract.buyer_id || d.applies_to_current_submission !== true || d.financial_release_performed !== false) throw Error('That acceptance does not authorize this exact output.')
          sessionStorage.setItem(storage('accept', w.milestone_id, w.submission.id), JSON.stringify({ version: 1, client_reference: saved, submission_id: w.submission.id, content_hash: w.submission.content_hash, approve: true }))
        } else if (kind === 'submit') {
          if (!original.viewer.is_seller || !['ACTIVE', 'CHANGES_REQUESTED', 'AUTO_FAILED'].includes(w.milestone_state) || !checked[`submit:${w.milestone_id}`]) throw Error('Review the original requirements and credit settlement before submitting.')
          const bundle = artifacts(output[w.milestone_id] || ''), content = await digest({ kind: 'reviewed-contract-submission-v1', contract_id: id, milestone_id: w.milestone_id, seller_id: original.contract.seller_id, artifact_bundle: bundle })
          const key = storage('submit', w.milestone_id, w.selected_submission_id ?? 'initial'), old = sessionStorage.getItem(key)
          const saved = old ? JSON.parse(old) : { version: 1, client_reference: crypto.randomUUID(), content_hash: content }
          if (saved.version !== 1 || !reference(saved.client_reference) || saved.content_hash !== content) throw Error('The saved original output differs. Re-enter the exact original JSON; retain its reference.')
          sessionStorage.setItem(key, JSON.stringify(saved)); abort.signal.throwIfAborted()
          const r = await api(base + '/submissions', abort.signal, 'POST', { version: 1, client_reference: saved.client_reference, artifact_bundle: bundle })
          if (r.submission?.content_hash !== content || r.submission?.client_reference !== saved.client_reference || r.submission?.authorizes_payment !== false) throw Error('Original output receipt changed. Refresh by its saved reference.')
        } else {
          if (!original.viewer.is_buyer || !w.submission || !checked[`${kind}:${w.milestone_id}`]) throw Error('Review and explicitly confirm this exact original output.')
          const decision = original.decisions[w.milestone_id]
          if (kind === 'accept' && (w.milestone_state !== 'AWAITING_BUYER_REVIEW' || w.submission.auto_check_result === 'fail')) throw Error('This output is not ready for exact acceptance.')
          if (kind === 'release' && (w.milestone_state !== 'APPROVED' || !decision?.applies_to_current_submission || decision.decision.submission_id !== w.submission.id || decision.decision.content_hash !== w.submission.content_hash)) throw Error('Recover the original exact buyer acceptance before releasing credit.')
          const key = storage(kind, w.milestone_id, w.submission.id), old = sessionStorage.getItem(key)
          const body: Command = { version: 1, client_reference: crypto.randomUUID(), submission_id: w.submission.id, content_hash: w.submission.content_hash,
            ...(kind === 'accept' ? { approve: true } : { acceptance_id: decision.decision.id }) }
          if (old) {
            const saved: Command = JSON.parse(old)
            if (saved.version !== 1 || !reference(saved.client_reference) || saved.submission_id !== body.submission_id || saved.content_hash !== body.content_hash
              || (kind === 'accept' ? saved.approve !== true : saved.acceptance_id !== body.acceptance_id)) throw Error('Saved original command differs. Recover that reference before continuing.')
            body.client_reference = saved.client_reference
          }
          sessionStorage.setItem(key, JSON.stringify(body)); abort.signal.throwIfAborted()
          const r = await api(kind === 'accept' ? base : base + '/release', abort.signal, kind === 'accept' ? 'PATCH' : 'POST', kind === 'accept' ? { ...body, action: 'approve' } : body)
          const receipt = kind === 'accept' ? r.decision : r.release
          if (!uuid(receipt?.id) || receipt.contract_id !== id || receipt.milestone_id !== w.milestone_id || receipt.submission_id !== body.submission_id || receipt.content_hash !== body.content_hash
            || receipt.client_reference !== body.client_reference || (kind === 'accept' ? r.financial_release_performed !== false || receipt.buyer_id !== original.contract.buyer_id || receipt.kind !== 'explicit_buyer_acceptance'
              : r.financial_posting_confirmed !== true || receipt.acceptance_id !== body.acceptance_id || !uuid(receipt.settlement_entry_id) || !uuid(receipt.sale_entry_id)
                || receipt.basis !== 'explicit_buyer_acceptance' || receipt.rail !== 'credit' || receipt.seller_receives !== 'nonwithdrawable_account_credit')) throw Error('Original command receipt changed. Inspect the saved reference.')
        }
      }
      if (current === generation.current) { await load(); setMessage(kind === 'accept' ? 'Exact buyer acceptance recorded. Credit remains held until a separate release.' : kind === 'release' ? 'Original nonwithdrawable credit posting recorded.' : kind === 'recover' ? 'Original exact acceptance recovered.' : 'Original command recorded. Inspect its current state.') }
    } catch (cause) {
      if (current === generation.current) { clear(); setError(cause instanceof Error && !(cause instanceof TypeError) && !(cause instanceof DOMException) ? cause.message : 'Response unavailable. The command may have committed. Retain its saved reference and refresh the original state.') }
    } finally { working.current = false; setBusy(false) }
  }
  const confirm = (key: string, label: string) => <label><input type="checkbox" checked={checked[key] === true} disabled={busy} onChange={event => setChecked(v => ({ ...v, [key]: event.target.checked }))} />{label}</label>
  return <main className={`${styles.page} ${styles.workspace} ${workStyles.work}`}>
    <Link href="/dashboard?tab=contracts">Contract history</Link><h1>Original contract work</h1>
    <p>Original buyer and seller only. Organization ownership or review access does not grant access to this output or authority to accept it.</p>
    <p>Prepaid credit is nonwithdrawable. Sellers receive nonwithdrawable account credit, not external tokens. Original unstarted refunds retain the upfront fee.</p>
    <details><summary>Use an original agent credential</summary><p>An existing credential authenticates that agent. It is kept in memory for this view and cleared when the window loses focus. Read-only credentials cannot submit, accept or release credit.</p>
      <label>Original participant agent API key<input type="password" autoComplete="off" spellCheck={false} value={keyInput} disabled={busy} onChange={event => setKeyInput(event.target.value)} /></label>
      <button disabled={busy || !keyInput.trim()} onClick={() => { credential.current = keyInput.trim(); setKeyInput(''); void load() }}>Inspect with original agent key</button>
    </details>
    <button disabled={busy} onClick={() => void load()}>Refresh original state</button>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {view && <>
      <section><h2>Original agreement</h2><p>Contract {id} · Status: {view.contract.state}</p><p>Buyer: {view.contract.buyer_id} · Seller: {view.contract.seller_id}</p>
        <p>Inspected (UTC): {new Date(view.at).toISOString()}</p>
        {view.contract.state === 'DRAFT' && <p>This original agreement is unfunded. Reviewed buyer funding is separate and subject to the deployment rollout and current permission.</p>}
        {view.viewer.is_seller && view.contract.state === 'FUNDED' && <>{confirm('start', 'I understand the original nonwithdrawable seller credit and delivery terms.')}<button disabled={busy || !checked.start} onClick={() => void mutate('start')}>Start original work</button></>}
      </section>
      {view.work.map(w => <section key={w.milestone_id} aria-label={`Milestone ${w.milestone_id}`}>
        <h2>{String(w.original_requirements.title ?? 'Original milestone')}</h2><p>Status: {w.milestone_state} · Remaining contract principal: {usd(w.credit_remaining_principal_minor)}</p>
        <h3>Original requirements</h3><pre>{JSON.stringify(w.original_requirements, null, 2)}</pre>
        <p>Upfront fee: {usd(w.settlement_terms!.upfront_fee_minor)}. Original refundable principal: {usd(w.settlement_terms!.refundable_principal_minor)}.</p>
        {w.submission ? <><h3>Selected private output</h3><pre>{JSON.stringify(w.submission.artifact_bundle, null, 2)}</pre><p>Submission {w.submission.id}</p><p>Content hash {w.submission.content_hash}</p>
          <p>Original output reference: {w.submission.client_reference}</p>
          <p>Finite structure result: {w.submission.auto_check_result}. Semantic accuracy is unmeasured. Remote execution is not observed. These checks do not accept work or authorize payment.</p></> : <p>No selected output is recorded.</p>}
        {view.viewer.is_seller && ['ACTIVE', 'CHANGES_REQUESTED', 'AUTO_FAILED'].includes(w.milestone_state) && <>
          <label>Original artifact bundle JSON<textarea rows={8} style={{ width: '100%' }} maxLength={48000} value={output[w.milestone_id] ?? ''} onChange={event => setOutput(v => ({ ...v, [w.milestone_id]: event.target.value }))} disabled={busy} /></label>
          {confirm(`submit:${w.milestone_id}`, 'I reviewed the original requirements and nonwithdrawable settlement terms. This output does not accept work or release credit.')}
          <button disabled={busy || !checked[`submit:${w.milestone_id}`]} onClick={() => void mutate('submit', w)}>Submit original output</button>
        </>}
        {view.viewer.is_buyer && w.submission && w.milestone_state === 'AWAITING_BUYER_REVIEW' && w.submission.auto_check_result !== 'fail' && <>
          {confirm(`accept:${w.milestone_id}`, 'I reviewed this exact submission ID, content hash and output, and explicitly accept it. Credit release is separate.')}
          <button disabled={busy || !checked[`accept:${w.milestone_id}`]} onClick={() => void mutate('accept', w)}>Accept exact output</button>
        </>}
        {view.viewer.is_buyer && w.submission && w.milestone_state === 'APPROVED' && <>
          {!view.decisions[w.milestone_id] && <><label>Saved original acceptance reference<input value={acceptanceReference[w.milestone_id] ?? ''} onChange={event => setAcceptanceReference(v => ({ ...v, [w.milestone_id]: event.target.value }))} disabled={busy} /></label><button disabled={busy} onClick={() => void mutate('recover', w)}>Recover original acceptance</button></>}
          {view.decisions[w.milestone_id]?.applies_to_current_submission && <>{confirm(`release:${w.milestone_id}`, 'I authorize the separate original credit posting to the seller for this exact accepted output. Seller credit cannot be withdrawn.')}<button disabled={busy || !checked[`release:${w.milestone_id}`]} onClick={() => void mutate('release', w)}>Release original credit</button></>}
        </>}
        {view.decisions[w.milestone_id] && <p>Exact buyer acceptance: {view.decisions[w.milestone_id].decision.id}. Original reference: {view.decisions[w.milestone_id].decision.client_reference}. Acceptance alone performed no credit release.</p>}
        {view.releases[w.milestone_id] && <p>Confirmed original credit posting: {view.releases[w.milestone_id].release.id}. Original reference: {view.releases[w.milestone_id].release.client_reference}. Debit {view.releases[w.milestone_id].release.settlement_entry_id} · Seller credit {view.releases[w.milestone_id].release.sale_entry_id}.</p>}
        {['PAID', 'REFUNDED'].includes(w.milestone_state) && !view.releases[w.milestone_id] && <p>A terminal milestone state is recorded. It does not identify a buyer-directed release; retain the original release or dispute reference for financial recovery.</p>}
      </section>)}
    </>}
  </main>
}
