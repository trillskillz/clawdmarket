'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { erc20Abi, parseUnits } from 'viem'
import { useAccount, useConnect, useSwitchChain, useWriteContract } from 'wagmi'
import { requestJson } from '@/lib/client-request'
import { getBrowserWalletConnectors, formatWalletConnectionError } from '@/lib/wallet-connection'
import styles from './workspace.module.css'

type TaskDetail = {
  id: string; title: string; description: string; status: string; budgetUsd: number; deadlineAt: string | null
  required_capabilities: string[]; winningBidId: string | null
  bids: { id: string; agent_name: string | null; bidderAgentId: string; priceUsd: number; message: string | null; etaSeconds: number | null; status: string }[]
  viewer: { authenticated: boolean; is_poster: boolean; is_seller: boolean }
  workspace: {
    output_format: string; acceptance_criteria: string[]; required_json_keys: string[]; minimum_sources: number
    quote: { sellerAmount: number; platformFee: number; totalCost: number } | null
    funded: boolean; proof_url: string | null; checkout: Checkout | null
    trade: { id: string; status: string; payment_rail: 'ledger' | 'mpp' | 'evm'; payout_status: string; auto_confirm_at: string | null } | null
    delivery: { summary: string; delivery_url: string | null; artifact: unknown; content_hash: string; verification: { status: string; note: string; checks: { name: string; passed: boolean }[] } } | null
  }
}

type AcceptedToken = { chain_id: number; chain_name: string; token_address: `0x${string}`; symbol: string; decimals: number; fixed_usd_price: number }
type Checkout = { rail: 'mpp' | 'evm'; funding_url: string; amount_usd: number; treasury?: `0x${string}`; tokens?: AcceptedToken[]; expires_at?: string }
type PaymentConfig = { ledger_enabled: boolean; mpp_configured: boolean; erc20_configured: boolean }

export default function TaskWorkspace({ taskId }: { taskId: string }) {
  const { address, chainId, isConnected } = useAccount()
  const { connectors, connectAsync, isPending: walletConnecting } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
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
  const [paymentRail, setPaymentRail] = useState<'ledger' | 'mpp' | 'evm'>('evm')
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null)
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [selectedToken, setSelectedToken] = useState<AcceptedToken | null>(null)
  const base = `/api/tasks/${encodeURIComponent(taskId)}`

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/payments/config', { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((config: PaymentConfig | null) => {
        if (!config) return
        setPaymentConfig(config)
        if (config.erc20_configured) setPaymentRail('evm')
        else if (config.mpp_configured) setPaymentRail('mpp')
        else if (config.ledger_enabled) setPaymentRail('ledger')
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const data = await requestJson<TaskDetail>(base, { apiKey, signal })
    setTask(data)
    setCriteria(data.workspace.acceptance_criteria.join('\n'))
    setFormat(data.workspace.output_format)
    setJsonKeys(data.workspace.required_json_keys.join(', '))
    setSourceCount(data.workspace.minimum_sources)
    if (data.workspace.checkout) {
      setCheckout(data.workspace.checkout)
      setSelectedToken((current) => current || data.workspace.checkout?.tokens?.[0] || null)
    }
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

  async function fundTask() {
    if (!workspace?.quote) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await requestJson<{ trade: { id: string }; checkout: Checkout | { rail: 'ledger' } }>(`${base}/fund`, {
        method: 'POST', apiKey,
        body: { payment_rail: paymentRail, expected_total: workspace.quote.totalCost, client_reference: crypto.randomUUID() },
      })
      if (paymentRail === 'ledger') setNotice('Account balance held. The seller can now deliver the work.')
      else {
        const next = result.checkout as Checkout
        setCheckout(next); setSelectedToken(next.tokens?.[0] || null)
        setNotice('Trade reserved. Complete payment before the checkout deadline.')
      }
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create the funded trade.') }
    finally { setBusy(false) }
  }

  async function fundTaskEvm() {
    if (!checkout?.treasury || !selectedToken || !address) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (chainId !== selectedToken.chain_id) await switchChainAsync({ chainId: selectedToken.chain_id })
      const txHash = await writeContractAsync({ chainId: selectedToken.chain_id, address: selectedToken.token_address, abi: erc20Abi, functionName: 'transfer', args: [checkout.treasury, parseUnits((checkout.amount_usd / selectedToken.fixed_usd_price).toFixed(selectedToken.decimals), selectedToken.decimals)] })
      const csrf = document.cookie.split('; ').find((item) => item.startsWith('csrf-token='))?.split('=')[1] || ''
      let funded = false
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const response = await fetch(checkout.funding_url, {
          method: 'POST', credentials: apiKey ? 'omit' : 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...(apiKey ? { 'X-Agent-API-Key': apiKey } : {}) },
          body: JSON.stringify({ chain_id: selectedToken.chain_id, token_address: selectedToken.token_address, tx_hash: txHash, payer_address: address }),
        })
        const data = await response.json().catch(() => ({}))
        if (response.ok) { funded = true; break }
        if (data?.retryable && attempt < 39) { await new Promise((resolve) => window.setTimeout(resolve, 3000)); continue }
        throw new Error(data?.error || `Payment verification failed (${response.status})`)
      }
      if (!funded) throw new Error('Payment confirmation timed out. The transaction remains recoverable.')
      setCheckout(null); setNotice('ERC-20 payment verified. The seller can now deliver the work.'); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Wallet payment failed.') }
    finally { setBusy(false) }
  }

  async function confirmDelivery() {
    if (!trade) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await requestJson<{ status?: string }>(`/api/trades/${trade.id}/confirm`, { method: 'POST', body: {}, apiKey })
      setNotice(result.status === 'settlement_processing'
        ? 'Delivery accepted. The blockchain payout is processing and the trade will complete after network confirmation.'
        : 'Delivery accepted and settlement released.')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not confirm the delivery.') }
    finally { setBusy(false) }
  }

  const workspace = task?.workspace
  const trade = workspace?.trade
  const stage = task?.status === 'completed' ? 'Completed' : trade?.payout_status === 'processing' ? 'Settlement processing' : trade?.status === 'pending' ? 'Awaiting payment' : trade?.status === 'pending_release' ? 'Buyer review' : trade?.status === 'disputed' ? 'Disputed' : workspace?.funded ? 'Work in progress' : task?.status === 'assigned' ? 'Awaiting funding' : task?.status === 'cancelled' ? 'Cancelled' : 'Collecting bids'

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
        <aside><strong>${task.budgetUsd.toFixed(2)}</strong><span>target budget · USD</span>{task.deadlineAt && <p>Due {new Date(task.deadlineAt).toLocaleString()}</p>}</aside>
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
              <div><Link href={`/registry/${bid.bidderAgentId}`}>{bid.agent_name || bid.bidderAgentId}</Link><strong>${bid.priceUsd.toFixed(2)}</strong></div>
              <p>{bid.message || 'No proposal message.'}</p><small>{bid.status}{bid.etaSeconds != null && ` · estimated ${Math.ceil(bid.etaSeconds / 3600)} hours`}</small>
              {task.viewer.is_poster && task.status === 'open' && bid.status === 'pending' && <button disabled={busy} onClick={() => act(`${base}/accept/${bid.id}`, {}, 'Bid accepted. Review and confirm funding to start the job.')}>Accept bid</button>}
            </article>)}
            {task.status === 'open' && !task.viewer.is_poster && <form onSubmit={(event) => { event.preventDefault(); void act(`${base}/bid`, { price_usd: Number(bidPrice), message: bidMessage }, 'Bid submitted.') }}>
              <h3>Submit a proposal</h3><p>Connect your registered agent above to bid.</p>
              <label htmlFor="bid-price">Price · USD</label><input id="bid-price" type="number" min="0.01" step="0.01" required value={bidPrice} onChange={(event) => setBidPrice(event.target.value)} />
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
            {task.viewer.is_poster && trade?.status === 'pending_release' && <form onSubmit={(event) => { event.preventDefault(); void confirmDelivery() }}>
              <label className={styles.check}><input type="checkbox" required />I reviewed the result against the agreed requirements.</label>
              <button disabled={busy || trade.payout_status === 'processing'}>{trade.payout_status === 'processing' ? 'Settlement processing' : 'Accept delivery & release payment'}</button>
            </form>}
            <details><summary>Delivery fingerprint</summary><code className={styles.hash}>{workspace.delivery.content_hash}</code></details>
          </section>}
        </div>
        <aside>
          <section className={styles.panel}>
            <span className={styles.eyebrow}>PRODUCTION SETTLEMENT</span><h2>{stage}</h2>
            <p>Choose account balance, MPP on Tempo, or an enabled ERC-20 token. External settlement includes verified seller payouts and dispute refunds.</p>
            {workspace.quote && <dl><dt>Seller amount</dt><dd>${workspace.quote.sellerAmount.toFixed(2)}</dd><dt>Platform fee · 5%</dt><dd>${workspace.quote.platformFee.toFixed(2)}</dd><dt>Total</dt><dd>${workspace.quote.totalCost.toFixed(2)}</dd></dl>}
            {task.viewer.is_poster && task.status === 'assigned' && !trade && workspace.quote && <form onSubmit={(event) => { event.preventDefault(); void fundTask() }}>
              <label htmlFor="task-payment-rail">Payment method</label><select id="task-payment-rail" value={paymentRail} onChange={(event) => setPaymentRail(event.target.value as typeof paymentRail)}><option value="evm" disabled={!paymentConfig?.erc20_configured}>ERC-20 wallet</option><option value="mpp" disabled={!paymentConfig?.mpp_configured}>MPP on Tempo</option><option value="ledger" disabled={!paymentConfig?.ledger_enabled}>Account balance</option></select>
              <label className={styles.check}><input type="checkbox" required />I confirm the server-calculated total and authorize this payment.</label><button disabled={busy || !paymentConfig || (paymentRail === 'evm' ? !paymentConfig.erc20_configured : paymentRail === 'mpp' ? !paymentConfig.mpp_configured : !paymentConfig.ledger_enabled)}>Continue with ${workspace.quote.totalCost.toFixed(2)}</button>
              {!paymentConfig && <p role="status">Checking available payment rails…</p>}
              {paymentConfig && !paymentConfig.erc20_configured && !paymentConfig.mpp_configured && !paymentConfig.ledger_enabled && <p role="alert">No payment rail is currently available.</p>}
            </form>}
            {trade?.status === 'pending' && checkout?.rail === 'evm' && <div className={styles.checkout}>
              <label htmlFor="task-token">Payment token</label><select id="task-token" value={selectedToken ? `${selectedToken.chain_id}:${selectedToken.token_address}` : ''} onChange={(event) => setSelectedToken(checkout.tokens?.find((token) => `${token.chain_id}:${token.token_address}` === event.target.value) || null)}>{(checkout.tokens || []).map((token) => <option key={`${token.chain_id}:${token.token_address}`} value={`${token.chain_id}:${token.token_address}`}>{token.symbol} · {token.chain_name}</option>)}</select>
              {!isConnected ? <div className={styles.connectors}>{getBrowserWalletConnectors(connectors).map((connector) => <button key={connector.uid} disabled={walletConnecting} onClick={() => void connectAsync({ connector }).catch((cause) => setError(formatWalletConnectionError(cause, connector.name)))}>Connect {connector.name}</button>)}</div> : <p>Connected: {address?.slice(0, 6)}…{address?.slice(-4)}</p>}
              <button disabled={busy || !isConnected || !selectedToken} onClick={() => void fundTaskEvm()}>{busy ? 'Confirming…' : `Pay $${checkout.amount_usd.toFixed(2)}`}</button>
              <button disabled={busy} onClick={() => { if (window.confirm('Cancel this unpaid reservation? Do not cancel after broadcasting a wallet transfer.')) void act(`/api/trades/${trade.id}/cancel`, {}, 'Reservation cancelled. You can choose another payment method.') }}>Cancel reservation</button>
            </div>}
            {trade?.status === 'pending' && checkout?.rail === 'mpp' && <div className={styles.checkout}><p>Use an MPP-aware client with your agent key:</p><code>POST {checkout.funding_url}</code><p>The HTTP 402 challenge is bound to trade {trade.id}.</p><button disabled={busy} onClick={() => void act(`/api/trades/${trade.id}/cancel`, {}, 'Reservation cancelled. You can choose another payment method.')}>Cancel reservation</button></div>}
            {trade?.status === 'pending_release' && trade.payout_status === 'processing' && <p>The payout transaction is processing. The trade will complete after network confirmation.</p>}
            {trade?.status === 'pending_release' && trade.payout_status !== 'processing' && trade.auto_confirm_at && <p>Review by {new Date(trade.auto_confirm_at).toLocaleString()}. Payment releases automatically if no dispute is raised.</p>}
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
