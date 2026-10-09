'use client'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

type Purchase = { permissions: { approve: boolean; cancel: boolean; revoke: boolean }; request: { id: string; request_hash: string; objective?: string; order_json: string; amount_minor: number; payment_rail: string;
  buyer_id: string; team_id: string | null; cost_center: string; expires_at: string; state: string };
  approval: { id: string; state: string; expires_at: string } | null; use: { order_id: string; trade_id: string } | null }
export default function PurchaseReview({ params }: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = use(params), path = `/api/organizations/${encodeURIComponent(id)}/purchasing/requests/${encodeURIComponent(requestId)}`
  const [purchase, setPurchase] = useState<Purchase | null>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const decision = useRef<object | null>(null)
  const load = useCallback(async () => {
    const response = await fetch(path, { cache: 'no-store' }), value = await response.json()
    if (!response.ok) { setPurchase(null); setMessage('Sign in as the requester, selected reviewer or organization owner to view this purchase.'); return }
    setPurchase(value)
  }, [path])
  useEffect(() => { load().catch(() => setMessage('Unable to load this purchase. Try again.')) }, [load])
  async function act(action: 'approve' | 'revoke' | 'cancel') {
    if (!purchase) return
    setBusy(true); setMessage('')
    try {
      if (action === 'approve' && !decision.current) decision.current = { version: 1, client_reference: crypto.randomUUID(),
        request_hash: purchase.request.request_hash, approve: true, expires_at: purchase.request.expires_at }
      const csrf = document.cookie.split('; ').find(value => value.startsWith('csrf-token='))?.slice('csrf-token='.length) || ''
      const response = await fetch(path + (action === 'cancel' ? '' : '/approval'), { method: action === 'approve' ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf) },
        ...(action === 'approve' ? { body: JSON.stringify(decision.current) } : {}) })
      const value = await response.json()
      if (!response.ok) setMessage(`Purchase action failed: ${value.error_code || 'REQUEST_UNCERTAIN'}. Refresh to inspect the saved decision.`)
      else setMessage(action === 'approve' ? 'Purchase approved.' : action === 'revoke' ? 'Approval revoked.' : 'Purchase cancelled.')
      await load()
    } catch { setMessage('The response was lost. Refresh to inspect the saved decision before trying again.') }
    finally { setBusy(false) }
  }
  const order = purchase ? JSON.parse(purchase.request.order_json) : null
  return <main className="mx-auto max-w-3xl px-5 py-12">
    <h1 className="mb-6 text-2xl font-semibold">Purchase review</h1>
    {message && <p role="status" className="mb-5">{message}</p>}
    {purchase && <>
      <p className="mb-5">{order.objective}</p>
      <dl className="grid grid-cols-2 gap-3 break-words">
        <dt>Total including fee</dt><dd>${(purchase.request.amount_minor / 100).toFixed(2)} USD</dd>
        <dt>Payment method</dt><dd>{purchase.request.payment_rail.toUpperCase()}</dd>
        <dt>Cost center</dt><dd>{purchase.request.cost_center}</dd>
        <dt>Expires</dt><dd>{new Date(purchase.request.expires_at).toLocaleString()}</dd>
        <dt>Request</dt><dd>{purchase.request.state}</dd>
        <dt>Approval</dt><dd>{purchase.approval?.state || 'Awaiting review'}</dd>
      </dl>
      <details className="my-6"><summary>Review exact private input and provider requirements</summary>
        <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded border p-4">{JSON.stringify({ input: order.input, provider_requirements: order.provider_requirements }, null, 2)}</pre>
      </details>
      {purchase.use ? <p>Used for <Link className="underline" href={`/proof/${purchase.use.trade_id}`}>the original purchase</Link>.</p>
        : <div className="mt-6 flex flex-wrap gap-3">
          {purchase.permissions.approve && <button disabled={busy} onClick={() => act('approve')} className="rounded border px-4 py-2">Approve exact purchase</button>}
          {purchase.permissions.revoke && <button disabled={busy} onClick={() => act('revoke')} className="rounded border px-4 py-2">Revoke approval</button>}
          {purchase.permissions.cancel && <button disabled={busy} onClick={() => act('cancel')} className="rounded border px-4 py-2">Cancel request</button>}
        </div>}
      <p className="mt-6 text-sm">The buyer must still authorize payment. All spending limits and verification requirements apply.</p>
    </>}
  </main>
}
