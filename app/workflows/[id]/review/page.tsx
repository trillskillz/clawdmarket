'use client'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import type { input } from 'zod'
import Link from 'next/link'
import styles from '@/app/organizations/enterprise.module.css'
import reviewStyles from './review.module.css'

type Terms = input<typeof import('@/lib/workflow-approval').workflowApprovalInput>
type Plan = { id: string; buyer_id: string; objective: string; max_budget_minor: number; deadline_seconds: number;
  nodes: { key: string; objective: string; depends_on: string[]; budget_minor: number; required_capabilities: string[]; deadline_seconds: number }[] }
type Review = { workflow: Plan | null; workflow_state: string; plan_hash: string | null;
  approval: { id: string; state: 'approved' | 'revoked'; contract_hash: string; current_plan_matches: boolean; expired: boolean; current_owner_controls: boolean;
    expires_at: string; contract: { workflow: Plan; terms: Terms; token: Record<string, unknown> } } | null }
type Run = { run: { id: string }; completed: boolean; receipt: { settlement_status: string;
  totals: { gross_buyer_minor: number; confirmed_refund_minor: number; confirmed_seller_payout_minor: number; unresolved_buyer_minor: number;
    chain_fee_measurement: string; actual_chain_fee_units: string | null; chain_fee_currency: { chain_id: number; unit: string; asset: string } };
  attempts: { trade_id: string; order_id: string; attempt_number: number; reconciled: boolean; capacity_released: boolean }[] } }
type Observation = { workflowId: string; review: Review; run: Run | null; runUnavailable: boolean; owner: boolean; at: number }
const money = (minor: number) => `$${(minor / 100).toFixed(2)} USD`
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const units = (value: unknown) => typeof value === 'string' && /^(?:0|[1-9][0-9]{0,77})$/.test(value)
/** Only makes the proposal readable. The authoritative API validates every term. */
function proposedTerms(source: string): Terms {
  if (new TextEncoder().encode(source).length > 196_608) throw Error('oversized proposal')
  const value: unknown = JSON.parse(source)
  JSON.stringify(value) // Reject structures too deep to render before retaining a proposal.
  const payment = object(value) && object(value.payment) ? value.payment : null
  if (!object(value) || value.version !== 1 || typeof value.client_reference !== 'string' || !value.client_reference
    || typeof value.plan_hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.plan_hash)
    || typeof value.expires_at !== 'string' || !Number.isFinite(Date.parse(value.expires_at))
    || !integer(value.max_gross_minor) || !units(value.max_chain_fee_units) || value.private_data !== 'selected_provider_only'
    || !payment || !['evm', 'mpp'].includes(String(payment.rail)) || !integer(payment.chain_id)
    || !['token_address', 'payer_address', 'treasury_address'].every(key => typeof payment[key] === 'string')
    || !units(payment.minimum_token_reserve_units)
    || (payment.rail === 'evm' ? !units(payment.minimum_native_reserve_wei) || !units(payment.max_gas_cost_wei)
      : typeof payment.fee_token_address !== 'string' || !units(payment.minimum_fee_token_reserve_units) || !units(payment.max_fee_token_cost_units))
    || !Array.isArray(value.nodes) || value.nodes.length < 1 || value.nodes.length > 16
    || !value.nodes.every(node => object(node) && typeof node.key === 'string' && object(node.static_input) && object(node.verification)
      && object(node.provider_requirements) && Array.isArray(node.provider_requirements.approved_providers)
      && node.provider_requirements.approved_providers.length > 0 && node.provider_requirements.approved_providers.every(provider => typeof provider === 'string')
      && ['max_per_attempt_minor', 'max_retry_minor', 'max_attempts', 'max_latency_seconds'].every(key => integer(node[key]))
      && units(node.max_chain_fee_per_attempt_units) && Array.isArray(node.dependency_inputs)
      && node.dependency_inputs.every(binding => object(binding) && typeof binding.source_node === 'string' && integer(binding.artifact_index) && typeof binding.target_field === 'string')))
    throw Error('unreadable proposal')
  return value as Terms
}

function TermsView({ terms }: { terms: Terms }) {
  return <div className={reviewStyles.terms}>
    <dl><div><dt>Gross purchase ceiling including retries and fees</dt><dd>{money(terms.max_gross_minor)}</dd></div>
      <div><dt>Aggregate buyer chain-fee ceiling</dt><dd>{terms.max_chain_fee_units} {terms.payment.rail === 'evm' ? 'wei' : 'fee-token base units'}</dd></div>
      <div><dt>Expires</dt><dd>{new Date(terms.expires_at).toLocaleString()}</dd></div>
      <div><dt>Payment rail / chain</dt><dd>{terms.payment.rail.toUpperCase()} / {terms.payment.chain_id}</dd></div></dl>
    <p>Payer {terms.payment.payer_address}</p><p>Token {terms.payment.token_address}</p><p>Treasury {terms.payment.treasury_address}</p>
    <p>Token reserve floor: {terms.payment.minimum_token_reserve_units} base units.</p>
    {terms.payment.rail === 'evm' ? <p>Native reserve floor: {terms.payment.minimum_native_reserve_wei} wei. Gas cost cap: {terms.payment.max_gas_cost_wei} wei.</p>
      : <p>Fee token {terms.payment.fee_token_address}. Reserve floor: {terms.payment.minimum_fee_token_reserve_units} base units. Cost cap: {terms.payment.max_fee_token_cost_units} base units.</p>}
    <p>Private data: selected provider only. Stable decision reference: {terms.client_reference}.</p>
    {terms.nodes.map(node => <article key={node.key}>
      <h3>Node {node.key}</h3><p>Per attempt {money(node.max_per_attempt_minor)} · Retry allowance {money(node.max_retry_minor)} · Maximum attempts {node.max_attempts}</p>
      <p>Runtime {node.max_latency_seconds} seconds · Buyer chain fee per attempt {node.max_chain_fee_per_attempt_units} base units</p>
      <p>Approved providers: {node.provider_requirements.approved_providers?.join(', ')}</p>
      <details><summary>Exact private input, dependencies and verification for {node.key}</summary><pre>{JSON.stringify({ static_input: node.static_input,
        dependency_inputs: node.dependency_inputs, provider_requirements: node.provider_requirements, verification: node.verification }, null, 2)}</pre></details>
    </article>)}
    <details><summary>Complete exact approval terms</summary><pre>{JSON.stringify(terms, null, 2)}</pre></details>
  </div>
}

export default function WorkflowReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params), path = `/api/workflows/${encodeURIComponent(id)}`
  const [observation, setObservation] = useState<Observation | null>(null), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [source, setSource] = useState(''), [proposal, setProposal] = useState<Terms | null>(null), [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [now, setNow] = useState(0)
  const generation = useRef(0), mutation = useRef(false)
  const invalidate = useCallback(() => { generation.current += 1 }, [])
  const load = useCallback(async () => {
    const current = ++generation.current
    setObservation(null); setReading(true); setError(''); setChecked(false)
    try {
      const response = await fetch(path + '/approval', { credentials: 'include', cache: 'no-store' })
      if (!response.ok) {
        if (current === generation.current) { setSource(''); setProposal(null); setError([401,403,404].includes(response.status)
          ? 'Sign in as the current buyer or linked owner to inspect this workflow.' : 'Workflow inspection is unavailable. Refresh before another decision.') }
        return false
      }
      const review: Review = await response.json()
      const [accountResponse, ownedResponse, runResponse] = await Promise.all([
        fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' }), fetch('/api/agents/ownership', { credentials: 'include', cache: 'no-store' }),
        fetch(path + '/execute', { credentials: 'include', cache: 'no-store' }),
      ])
      if (!accountResponse.ok) throw Error('account unavailable')
      const account = (await accountResponse.json()).user
      const buyer = review.workflow?.buyer_id || review.approval?.contract.workflow.buyer_id
      if (!ownedResponse.ok && !String(account.id).startsWith('user_agent_')) throw Error('ownership unavailable')
      const owned = ownedResponse.ok ? (await ownedResponse.json()).owned_agents as { agent_id: string }[] : []
      const owner = !String(account.id).startsWith('user_agent_') && (account.id === buyer || owned.some(agent => `user_agent_${agent.agent_id}` === buyer))
      let run: Run | null = null, runUnavailable = false
      if (runResponse.ok) run = await runResponse.json()
      else if (runResponse.status === 409 && review.approval && !review.approval.current_plan_matches) runUnavailable = true
      else if (runResponse.status !== 404 || (await runResponse.json()).error_code !== 'WORKFLOW_NOT_FOUND') throw Error('run unavailable')
      if (current !== generation.current) return false
      const at = Date.now(); setNow(at); setObservation({ workflowId: id, review, run, runUnavailable, owner, at }); return true
    } catch { if (current === generation.current) { setSource(''); setProposal(null); setError('Workflow inspection is unavailable. Refresh before another decision.') } return false }
    finally { if (current === generation.current) setReading(false) }
  }, [path, id])
  useEffect(() => { setSource(''); setProposal(null); setMessage(''); void load(); return invalidate }, [load, invalidate])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer) }, [])
  const stale = !!observation && now - observation.at >= 60_000
  const planMatches = !!proposal && proposal.plan_hash === observation?.review.plan_hash
  async function act(action: 'approve' | 'revoke') {
    if (mutation.current || !observation?.owner || observation.workflowId !== id || !checked || action === 'approve' && (!proposal || !planMatches || observation.review.approval)) return
    if (Date.now() - observation.at >= 60_000) { setNow(Date.now()); setChecked(false); return }
    const body = action === 'approve' ? JSON.stringify(proposal) : undefined, current = ++generation.current
    mutation.current = true; setBusy(true); setObservation(null); setChecked(false); setError(''); setMessage('')
    try {
      const csrf = decodeURIComponent(document.cookie.split('; ').find(cookie => cookie.startsWith('csrf-token='))?.slice(11) || '')
      const response = await fetch(path + '/approval', { method: action === 'approve' ? 'POST' : 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(body ? { body } : {}) })
      if (current !== generation.current) return
      if (!response.ok) { if ([401,403,404].includes(response.status)) { setSource(''); setProposal(null) }
        setError(response.status === 409 ? 'The plan or original decision changed. Refresh to inspect the saved contract.'
        : [401,403,404].includes(response.status) ? 'Current owner access is required. Refresh to inspect your access.'
        : 'The decision was not confirmed. Refresh to inspect original state before trying again.'); return }
      if (await load()) { setProposal(null); setSource(''); setMessage(action === 'approve'
        ? 'Exact workflow terms approved. Spending activation remains a separate owner decision.'
        : 'Fresh use revoked. Original children and unresolved money remain recoverable.') }
    } catch { if (current === generation.current) setError('The response was lost. The decision may have committed. Refresh original state before another command.') }
    finally { mutation.current = false; setBusy(false) }
  }
  const review = observation?.review, approval = review?.approval
  const disabled = busy || reading || !observation || stale
  return <main className={`${styles.page} ${styles.workspace} ${reviewStyles.page}`}>
    <header><h1>Workflow owner review</h1><p>Inspect the finite graph and exact bounded terms before recording a human decision.</p></header>
    <div className={styles.links}><Link href="/dashboard?tab=workflow-reviews">Back to Workflow Review</Link><button disabled={busy || reading} onClick={() => { setMessage(''); void load() }}>Refresh original state</button></div>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}{reading && <p role="status">Inspecting original workflow…</p>}
    {stale && <p role="alert">Inspection expired. Refresh original state before another decision.</p>}
    {observation && observation.workflowId === id && <>
      <section><h2>Current finite plan</h2><p>Workflow {id} · {review!.workflow_state}</p><p>Inspected {new Date(observation.at).toLocaleTimeString()}</p>
        {review!.workflow ? <><p>{review!.workflow.objective}</p><p>Buyer {review!.workflow.buyer_id}</p><p>Planned ceiling {money(review!.workflow.max_budget_minor)} · Deadline {review!.workflow.deadline_seconds} seconds</p>
          <div className={styles.grid}>{review!.workflow.nodes.map(node => <article key={node.key}><h3>{node.key}</h3><p>{node.objective}</p>
            <p>Requires {node.required_capabilities.join(', ')} · {money(node.budget_minor)}</p><p>Depends on {node.depends_on.join(', ') || 'No earlier nodes'} · Deadline {node.deadline_seconds} seconds</p></article>)}</div>
          <details><summary>Exact current plan hash</summary><p>{review!.plan_hash}</p></details></>
          : <p>The current graph cannot be validated. Inspect the original frozen decision below; no replacement is authorized.</p>}
        {!observation.owner && <p>This account can inspect the buyer’s record. A current human owner must record or revoke the decision.</p>}
      </section>
      {approval ? <section><h2>Original owner decision</h2><p>Approval {approval.id} · {approval.state} · {approval.expired ? 'Expired' : 'Within recorded expiry'}</p>
        <p>Current plan {approval.current_plan_matches ? 'matches' : 'differs from'} the frozen contract. Original owner {approval.current_owner_controls ? 'still controls' : 'no longer controls'} the buyer.</p>
        <p>Contract {approval.contract_hash}</p><TermsView terms={approval.contract.terms} />
        <details><summary>Original frozen graph and token configuration</summary><pre>{JSON.stringify({ workflow: approval.contract.workflow, token: approval.contract.token }, null, 2)}</pre></details>
        {observation.owner && approval.state === 'approved' && <><label className={reviewStyles.check}><input type="checkbox" checked={checked} disabled={disabled} onChange={event => setChecked(event.target.checked)} />I understand revocation stops fresh use and preserves original obligations.</label>
          <button disabled={disabled || !checked} onClick={() => void act('revoke')}>Revoke fresh workflow use</button></>}
      </section> : observation.owner && review!.workflow && review!.workflow_state === 'planned' && <section><h2>Proposed bounded terms</h2>
        <p>Paste the exact version-1 approval proposal from your buyer agent. Loading it only prepares this review; the server validates every term when you approve.</p>
        <form onSubmit={event => { event.preventDefault(); setChecked(false); setError(''); try { setProposal(proposedTerms(source)) } catch { setProposal(null); setError('The proposal cannot be read. Provide the complete bounded version-1 terms within 192 KiB.') } }}>
          <label>Exact approval proposal<textarea disabled={disabled} value={source} spellCheck={false} autoComplete="off" onChange={event => { setSource(event.target.value); setProposal(null); setChecked(false) }} /></label>
          <button disabled={disabled || !source}>Load proposed terms</button>
        </form>
        {proposal && <><TermsView terms={proposal} />{!planMatches && <p role="alert">Proposal plan hash differs from current inspection. Obtain terms for the exact current plan.</p>}
          <label className={reviewStyles.check}><input type="checkbox" disabled={disabled || !planMatches} checked={checked} onChange={event => setChecked(event.target.checked)} />I reviewed all exact inputs, dependencies, providers, verification, payment reserves and limits.</label>
          <button disabled={disabled || !planMatches || !checked} onClick={() => void act('approve')}>Approve exact workflow terms</button></>}
      </section>}
      <section><h2>Original run and money recovery</h2>{observation.run ? <>
        <p>Run {observation.run.run.id} · {observation.run.completed ? 'All required work reconciled' : 'Incomplete; original work requires recovery'}</p>
        <dl>{[['Gross buyer reservations', observation.run.receipt.totals.gross_buyer_minor], ['Confirmed buyer refunds', observation.run.receipt.totals.confirmed_refund_minor],
          ['Confirmed seller payouts', observation.run.receipt.totals.confirmed_seller_payout_minor], ['Unresolved original buyer amount', observation.run.receipt.totals.unresolved_buyer_minor]].map(([label, value]) => <div key={label as string}><dt>{label}</dt><dd>{money(value as number)}</dd></div>)}</dl>
        <p>Chain fees {observation.run.receipt.totals.chain_fee_measurement} · Actual combined fee {observation.run.receipt.totals.actual_chain_fee_units ?? 'Unknown'} {observation.run.receipt.totals.chain_fee_currency.unit} on chain {observation.run.receipt.totals.chain_fee_currency.chain_id} ({observation.run.receipt.totals.chain_fee_currency.asset})</p>
        <ul>{observation.run.receipt.attempts.map(attempt => <li key={attempt.trade_id}>Original order {attempt.order_id} · trade {attempt.trade_id} · Attempt {attempt.attempt_number} · {attempt.reconciled ? 'Reconciled' : 'Unresolved'} · Capacity {attempt.capacity_released ? 'released' : 'held'}</li>)}</ul>
      </> : observation.runUnavailable ? <p>The current plan differs from the frozen contract, so original run reconciliation is unavailable. Original money and capacity may remain unresolved. Revocation only stops fresh use; recover original children through their existing buyer/provider paths.</p>
        : <p>No original run is recorded. Approval alone does not activate or fund this workflow.</p>}</section>
      <p>Existing buyer/provider credentials recover original payment proof, delivery, review, payout/refund and private results. This page records approval or revocation; separate activation and payer authorization retain their existing controls.</p>
    </>}
  </main>
}
