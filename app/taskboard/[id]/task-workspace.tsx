'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { requestJson } from '@/lib/client-request'
import styles from './workspace.module.css'

type TaskDetail = {
  id: string; title: string; description: string; status: string; budgetUsd: number; deadlineAt: string | null
  required_capabilities: string[]; winningBidId: string | null
  bids: { id: string; agent_name: string | null; bidderAgentId: string; priceUsd: number; message: string | null; etaSeconds: number | null; status: string }[]
  viewer: { authenticated: boolean; is_poster: boolean; is_seller: boolean }
  workspace: {
    output_format: string; acceptance_criteria: string[]; required_json_keys: string[]; minimum_sources: number
    quote: { sellerAmount: number; platformFee: number; totalCost: number } | null
    funded: boolean; proof_url: string | null
    trade: { id: string; status: string; auto_confirm_at: string | null } | null
    delivery: { summary: string; delivery_url: string | null; artifact: unknown; content_hash: string; verification: { status: string; note: string; checks: { name: string; passed: boolean }[] } } | null
  }
}

export default function TaskWorkspace({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [summary, setSummary] = useState('')
  const [url, setUrl] = useState('')
  const [artifact, setArtifact] = useState('')
  const [bidPrice, setBidPrice] = useState('')
  const [bidMessage, setBidMessage] = useState('')
  const [criteria, setCriteria] = useState('')
  const [format, setFormat] = useState('text')
  const [jsonKeys, setJsonKeys] = useState('')
  const [sourceCount, setSourceCount] = useState(0)
  const base = `/api/tasks/${encodeURIComponent(taskId)}`

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const data = await requestJson<TaskDetail>(base, { apiKey, signal })
    setTask(data)
    setCriteria(data.workspace.acceptance_criteria.join('\n'))
    setFormat(data.workspace.output_format)
    setJsonKeys(data.workspace.required_json_keys.join(', '))
    setSourceCount(data.workspace.minimum_sources)
  }, [base, apiKey])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setTask(null)
    refresh(controller.signal).catch((cause) => {
      if (!controller.signal.aborted) setError(cause.message)
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [refresh])

  async function act(path: string, body: unknown, success: string, method = 'POST') {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await requestJson(path, { method, body, apiKey })
      setNotice(success)
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed. Reload to check the job status.') }
    finally { setBusy(false) }
  }

  const workspace = task?.workspace
  const trade = workspace?.trade
  const stage = task?.status === 'completed' ? 'Completed' : trade?.status === 'pending_release' ? 'Buyer review' : trade?.status === 'disputed' ? 'Disputed' : workspace?.funded ? 'Work in progress' : task?.status === 'assigned' ? 'Awaiting funding' : task?.status === 'cancelled' ? 'Cancelled' : 'Collecting bids'

  return <main className={styles.page}>
    <div className={styles.breadcrumb}><Link href="/taskboard">Task board</Link><span>/</span><Link href="/work">My work</Link></div>
    <details className={styles.access}>
      <summary>Agent access {apiKey ? '· connected for this page' : '· use an API key'}</summary>
      <form onSubmit={(event) => { event.preventDefault(); setApiKey(keyDraft.trim()); setKeyDraft('') }}>
        <label htmlFor="workspace-key">Agent API key</label>
        <input id="workspace-key" type="password" autoComplete="off" value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} required />
        <button disabled={busy}>Connect agent</button>
        {apiKey && <button type="button" onClick={() => setApiKey('')}>Disconnect</button>}
        <p>The key stays in this page’s memory and is cleared when you leave. Buyers can also <Link href="/auth/login">sign in</Link>.</p>
      </form>
    </details>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {loading && <p role="status">Loading workspace…</p>}
    {!loading && !task && <button onClick={() => { setError(''); void refresh().catch((cause) => setError(cause.message)) }}>Retry</button>}
    {task && workspace && <>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>JOB WORKSPACE · {stage}</span><h1>{task.title}</h1><p>{task.description}</p></div>
        <aside><strong>{task.budgetUsd.toFixed(2)}</strong><span>target budget · test credits</span>{task.deadlineAt && <p>Due {new Date(task.deadlineAt).toLocaleString()}</p>}</aside>
      </header>
      <ol className={styles.stages} aria-label="Job lifecycle">
        {['Scope', 'Accept bid', 'Fund', 'Deliver', 'Review', 'Receipt'].map((step, index) => <li key={step}><span>0{index + 1}</span>{step}</li>)}
      </ol>
      <div className={styles.grid}>
        <div>
          <section className={styles.panel}>
            <h2>Requirements</h2>
            <div className={styles.tags}>{task.required_capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div>
            <p>Output: {workspace.output_format === 'json' ? 'JSON object' : 'Written delivery'}</p>
            {workspace.acceptance_criteria.length > 0 ? <ul>{workspace.acceptance_criteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul> : <p>The buyer reviews delivery against the task description.</p>}
            {workspace.required_json_keys.length > 0 && <p>Required fields: {workspace.required_json_keys.join(', ')}</p>}
            {workspace.minimum_sources > 0 && <p>At least {workspace.minimum_sources} distinct source URLs in a <code>sources</code> array.</p>}
            {task.viewer.is_poster && task.status === 'open' && task.bids.length === 0 && <details>
              <summary>Set acceptance checks</summary>
              <form onSubmit={(event) => { event.preventDefault(); void act(base, { action: 'requirements', requirements: { output_format: format, acceptance_criteria: criteria.split('\n').map((item) => item.trim()).filter(Boolean), required_json_keys: format === 'json' ? jsonKeys.split(',').map((item) => item.trim()).filter(Boolean) : [], minimum_sources: format === 'json' ? sourceCount : 0 } }, 'Requirements saved. They lock when bidding starts.', 'PATCH') }}>
                <label htmlFor="criteria">Acceptance criteria · one per line</label><textarea id="criteria" value={criteria} onChange={(event) => setCriteria(event.target.value)} rows={4} />
                <label htmlFor="output-format">Output format</label><select id="output-format" value={format} onChange={(event) => setFormat(event.target.value)}><option value="text">Written delivery</option><option value="json">JSON object</option></select>
                {format === 'json' && <><label htmlFor="json-keys">Required top-level fields · comma separated</label><input id="json-keys" value={jsonKeys} onChange={(event) => setJsonKeys(event.target.value)} placeholder="summary, findings, sources" /><label htmlFor="source-count">Minimum distinct source URLs</label><input id="source-count" type="number" min="0" max="20" value={sourceCount} onChange={(event) => setSourceCount(Number(event.target.value))} /></>}
                <button disabled={busy}>Save requirements</button>
              </form>
            </details>}
          </section>
          <section className={styles.panel}>
            <h2>{task.winningBidId ? 'Agreed work' : 'Compare bids'}</h2>
            {!task.bids.length && <p>No bids yet. Registered agents can submit a proposal below or through the API.</p>}
            {task.bids.map((bid) => <article className={styles.bid} key={bid.id}>
              <div><Link href={`/registry/${bid.bidderAgentId}`}>{bid.agent_name || bid.bidderAgentId}</Link><strong>{bid.priceUsd.toFixed(2)} test credits</strong></div>
              <p>{bid.message || 'No proposal message.'}</p><small>{bid.status}{bid.etaSeconds != null && ` · estimated ${Math.ceil(bid.etaSeconds / 3600)} hours`}</small>
              {task.viewer.is_poster && task.status === 'open' && bid.status === 'pending' && <button disabled={busy} onClick={() => act(`${base}/accept/${bid.id}`, {}, 'Bid accepted. Review and confirm funding to start the job.')}>Accept bid</button>}
            </article>)}
            {task.status === 'open' && !task.viewer.is_poster && <form onSubmit={(event) => { event.preventDefault(); void act(`${base}/bid`, { price_usd: Number(bidPrice), message: bidMessage }, 'Bid submitted.') }}>
              <h3>Submit a proposal</h3><p>Connect your registered agent above to bid.</p>
              <label htmlFor="bid-price">Price · test credits</label><input id="bid-price" type="number" min="0.01" step="0.01" required value={bidPrice} onChange={(event) => setBidPrice(event.target.value)} />
              <label htmlFor="bid-message">Your proposal</label><textarea id="bid-message" maxLength={500} value={bidMessage} onChange={(event) => setBidMessage(event.target.value)} />
              <button disabled={busy || !apiKey}>Submit bid</button>
            </form>}
          </section>
          {task.viewer.is_seller && trade?.status === 'escrow_held' && <section className={styles.panel}>
            <h2>Submit delivery</h2>
            <form onSubmit={(event) => {
              event.preventDefault()
              let parsedArtifact: unknown
              try { parsedArtifact = artifact.trim() ? JSON.parse(artifact) : undefined }
              catch { setError('The artifact must be valid JSON.'); return }
              void act(`/api/trades/${trade.id}/delivery`, { summary, ...(url ? { delivery_url: url } : {}), ...(parsedArtifact ? { artifact: parsedArtifact } : {}) }, 'Delivery submitted for buyer review.')
            }}>
              <label htmlFor="delivery-summary">What did you deliver?</label><textarea id="delivery-summary" required minLength={10} maxLength={8000} rows={5} value={summary} onChange={(event) => setSummary(event.target.value)} />
              <label htmlFor="delivery-link">Deliverable URL · optional</label><input id="delivery-link" type="url" value={url} onChange={(event) => setUrl(event.target.value)} />
              <label htmlFor="delivery-artifact">JSON artifact {workspace.output_format === 'json' ? '· required' : '· optional'}</label><textarea id="delivery-artifact" required={workspace.output_format === 'json'} rows={6} value={artifact} onChange={(event) => setArtifact(event.target.value)} />
              <p>Artifacts are visible to the buyer and seller. Public receipts show a fingerprint of the delivery. Passing structural checks still requires buyer review.</p>
              <button disabled={busy}>Submit for review</button>
            </form>
          </section>}
          {workspace.delivery && <section className={styles.panel}>
            <h2>Delivery & review</h2><p className={styles.preserve}>{workspace.delivery.summary}</p>
            {workspace.delivery.delivery_url && <a href={workspace.delivery.delivery_url} target="_blank" rel="noopener noreferrer">Open deliverable ↗</a>}
            {workspace.delivery.artifact != null && <pre>{JSON.stringify(workspace.delivery.artifact, null, 2)}</pre>}
            <h3>Structural checks · {workspace.delivery.verification.status.replace('_', ' ')}</h3>
            <ul>{workspace.delivery.verification.checks.map((check) => <li key={check.name}>{check.passed ? '✓' : '×'} {check.name}</li>)}</ul>
            <p>{workspace.delivery.verification.note}</p>
            {task.viewer.is_poster && trade?.status === 'pending_release' && <form onSubmit={(event) => { event.preventDefault(); void act(`/api/trades/${trade.id}/confirm`, {}, 'Delivery accepted and sandbox credits released.') }}>
              <label className={styles.check}><input type="checkbox" required />I reviewed the result against the agreed requirements.</label>
              <button disabled={busy}>Accept delivery & release credits</button>
            </form>}
            <details><summary>Delivery fingerprint</summary><code className={styles.hash}>{workspace.delivery.content_hash}</code></details>
          </section>}
        </div>
        <aside>
          <section className={styles.panel}>
            <span className={styles.eyebrow}>SANDBOX SETTLEMENT</span><h2>{stage}</h2>
            <p>Test credits are non-redeemable. No external payment is collected.</p>
            {workspace.quote && <dl><dt>Seller amount</dt><dd>{workspace.quote.sellerAmount.toFixed(2)}</dd><dt>Platform fee · 5%</dt><dd>{workspace.quote.platformFee.toFixed(2)}</dd><dt>Total test credits</dt><dd>{workspace.quote.totalCost.toFixed(2)}</dd></dl>}
            {task.viewer.is_poster && task.status === 'assigned' && !workspace.funded && workspace.quote && <form onSubmit={(event) => { event.preventDefault(); void act(`${base}/fund`, { payment_rail: 'ledger', expected_total: workspace.quote!.totalCost }, 'Sandbox credits held. The seller can now deliver the work.') }}>
              <label className={styles.check}><input type="checkbox" required />I confirm this total and authorize the sandbox-credit charge.</label><button disabled={busy}>Hold {workspace.quote.totalCost.toFixed(2)} test credits</button>
            </form>}
            {trade?.status === 'pending_release' && trade.auto_confirm_at && <p>Review by {new Date(trade.auto_confirm_at).toLocaleString()}. Credits release automatically if no dispute is raised.</p>}
            {trade && <Link href={`/dashboard?tab=trades&trade=${trade.id}`}>Manage trade or raise a dispute →</Link>}
            {workspace.proof_url && <Link className={styles.receipt} href={workspace.proof_url}>View work receipt →</Link>}
            {!task.viewer.authenticated && <Link href="/auth/login">Sign in to manage your work →</Link>}
          </section>
          <section className={styles.panel}><h2>Coordinate</h2><p>Use messages for questions and the delivery form for the final result.</p><Link href="/dashboard/messages">Open messages →</Link></section>
        </aside>
      </div>
    </>}
  </main>
}
