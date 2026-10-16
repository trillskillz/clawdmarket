'use client'
import { useEffect, useState } from 'react'

const rails = ['credit', 'ledger', 'mpp', 'evm']
export default function SellerPaymentRails({ agents }: { agents: Array<{ agent_id: string; name: string }> }) {
  const [subject, setSubject] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [notice, setNotice] = useState('Loading seller payment preferences…')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setReady(false)
    void fetch(`/api/payments/seller-rails${subject ? `?agent_id=${encodeURIComponent(subject)}` : ''}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() })
      .then(data => {
        if (controller.signal.aborted) return
        if (!Array.isArray(data?.supported_payment_rails) || data.supported_payment_rails.some((rail: unknown) => typeof rail !== 'string' || !rails.includes(rail))) throw new Error('Unavailable preferences')
        setSelected(data.supported_payment_rails)
        setNotice(data.payment_rails_confirmed ? 'Seller-confirmed payment rails.' : 'Unconfirmed settings do not accept prepaid credit. Confirm your supported rails and review any payment restrictions in existing listing text.')
        setReady(true)
      })
      .catch(() => { if (!controller.signal.aborted) setNotice('Payment preferences unavailable. Reload before changing them.') })
    return () => controller.abort()
  }, [subject])
  async function save() {
    setBusy(true)
    try {
      const csrf = document.cookie.split('; ').find(part => part.startsWith('csrf-token='))?.slice(11) || ''
      const response = await fetch('/api/payments/seller-rails', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ ...(subject ? { agent_id: subject } : {}), supported_payment_rails: selected }) })
      if (!response.ok) throw new Error()
      setNotice('Payment preferences saved for new orders. Existing orders retain their original settlement terms.')
    } catch { setNotice('Could not save payment preferences. Reload and try again.') }
    finally { setBusy(false) }
  }
  return <section aria-label="Seller payment rails" className="my-6 rounded border border-border p-4">
    <h4>Payment rails you accept as a seller</h4>
    <p>Credit pays you nonwithdrawable prepaid account credit. Ledger is a legacy internal balance. MPP and EVM pay your configured external wallet after settlement. Selecting no rails prevents new orders.</p>
    <label className="block min-w-0 max-w-full">Seller account<select value={subject} onChange={event => setSubject(event.target.value)} disabled={busy} className="mt-2 mb-2 block w-full min-w-0 max-w-full rounded border bg-bg p-2"><option value="">My account</option>{agents.map(agent => <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>)}</select></label>
    <fieldset disabled={!ready || busy}>{rails.map(rail => <label key={rail} className="mr-4 inline-block"><input type="checkbox" checked={selected.includes(rail)} onChange={event => setSelected(current => event.target.checked ? [...current, rail] : current.filter(value => value !== rail))} /> {rail.toUpperCase()}</label>)}</fieldset>
    <button type="button" className="btn-secondary my-2 px-4 py-2" disabled={!ready || busy} onClick={() => void save()}>Confirm supported rails</button>
    <p role="status">{notice}</p>
  </section>
}
