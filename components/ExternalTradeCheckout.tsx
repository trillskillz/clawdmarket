'use client'

import { useEffect, useRef, useState } from 'react'
import { erc20Abi, type Address } from 'viem'
import { useAccount, useConnect, useSignMessage, useSwitchChain, useWriteContract } from 'wagmi'
import { formatWalletConnectionError, getBrowserWalletConnectors } from '@/lib/wallet-connection'
import { fundingNotice, fundingOutcome, type EvmPaymentIntent, type FundingResult } from '@/lib/evm-payment-proof'
import { readSavedPayment, runRecoverableEvmPayment, type SavedEvmPayment } from '@/lib/evm-checkout-recovery'

export type CheckoutToken = { chain_id: number; chain_name: string; token_address: Address; symbol: string; decimals: number; fixed_usd_price: number }
export type ExternalCheckout = {
  rail: 'mpp' | 'evm'; funding_url: string; intent_url?: string; amount_usd: number
  treasury?: Address; tokens?: CheckoutToken[]; expires_at?: string | null
}

export default function ExternalTradeCheckout({ tradeId, checkout, apiKey, onUpdated }: {
  tradeId: string; checkout: ExternalCheckout; apiKey?: string
  onUpdated?: (result?: FundingResult) => void | Promise<void>
}) {
  const { address, chainId, isConnected } = useAccount()
  const { connectors, connectAsync, isPending: connecting } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const { signMessageAsync } = useSignMessage()
  const [token, setToken] = useState<CheckoutToken | null>(checkout.tokens?.[0] || null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(checkout.rail !== 'evm')
  const [intent, setIntent] = useState<EvmPaymentIntent | null>(null)
  const [saved, setSaved] = useState<SavedEvmPayment | null>(null)
  const [recoveryHash, setRecoveryHash] = useState('')
  const [notice, setNotice] = useState('')
  const [terminal, setTerminal] = useState(false)
  const [closed, setClosed] = useState(false)
  const running = useRef(false)
  const storageKey = `clawdmarket:evm-payment:${tradeId}`
  const intentUrl = checkout.intent_url || `${checkout.funding_url}/intent`

  async function api(path: string, method = 'GET', body?: unknown) {
    const csrf = document.cookie.split('; ').find((item) => item.startsWith('csrf-token='))?.split('=')[1] || ''
    return fetch(path, {
      method, credentials: apiKey ? 'omit' : 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...(apiKey ? { 'X-Agent-API-Key': apiKey } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  useEffect(() => {
    if (checkout.rail !== 'evm') return
    let active = true
    setReady(false); setTerminal(false)
    async function load() {
      const local = readSavedPayment(localStorage.getItem(storageKey))
      const response = await api(intentUrl)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not check payment recovery status')
      if (!active) return
      setSaved(local); setIntent(data.intent)
      if (data.intent) {
        const reservedToken = checkout.tokens?.find((item) => item.chain_id === data.intent.chain_id && item.token_address.toLowerCase() === data.intent.token_address)
        if (reservedToken) setToken(reservedToken)
      }
      setClosed(data.trade.status === 'cancelled')
      if (!['pending', 'cancelled'].includes(data.trade.status) || (data.trade.status === 'cancelled' && data.trade.payout_status === 'refunded')) {
        setTerminal(true); setNotice(fundingNotice({ ok: true, trade: data.trade }))
      }
      setReady(true)
    }
    void load().catch((error) => { if (active) setNotice(`${error.message}. Reload to retry; payment is disabled until recovery status is known.`) })
    return () => { active = false }
    // api uses only the identity supplied by these dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, intentUrl, apiKey, checkout.rail])

  function persist(record: SavedEvmPayment | null) {
    if (record) localStorage.setItem(storageKey, JSON.stringify(record))
    else localStorage.removeItem(storageKey)
    setSaved(record)
  }

  async function fund() {
    if (running.current || !ready || terminal) return
    running.current = true; setBusy(true); setNotice('')
    try {
      const local = readSavedPayment(localStorage.getItem(storageKey))
      const probe = `${storageKey}:probe`
      localStorage.setItem(probe, '1'); localStorage.removeItem(probe)
      if (!intent && !local && !recoveryHash && !closed && token && chainId !== token.chain_id) {
        await switchChainAsync({ chainId: token.chain_id })
      }
      const result = await runRecoverableEvmPayment({
        saved: local, recoveryHash, persist,
        reserve: async () => {
          const response = await api(intentUrl, 'POST', {
            chain_id: intent?.chain_id || token?.chain_id,
            token_address: intent?.token_address || token?.token_address,
            payer_address: intent?.payer_address || address,
            ...(recoveryHash ? { recovery_tx_hash: recoveryHash } : {}),
          })
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || 'Could not reserve payment')
          setIntent(data.intent)
          return data
        },
        broadcast: async (reserved) => {
          if (!address || address.toLowerCase() !== reserved.payer_address) throw new Error('Reconnect the wallet selected for this payment.')
          if (Date.parse(reserved.expires_at) <= Date.now()) throw new Error('Checkout expired. Do not send payment.')
          if (chainId !== reserved.chain_id) await switchChainAsync({ chainId: reserved.chain_id })
          return writeContractAsync({
            account: reserved.payer_address as Address, chainId: reserved.chain_id,
            address: reserved.token_address as Address, abi: erc20Abi, functionName: 'transfer',
            args: [reserved.treasury_address as Address, BigInt(reserved.token_amount)],
          })
        },
        releaseRejected: async (reserved) => {
          const response = await api(intentUrl, 'DELETE', { intent_id: reserved.id, reason: 'wallet_rejected' })
          const data = await response.json()
          if (response.ok && data.released) { setIntent(null); return true }
          return false
        },
        sign: async (message, payer) => {
          if (!address || address.toLowerCase() !== payer.toLowerCase()) throw new Error(`Reconnect payer ${payer} to authorize the existing transfer. Do not send another payment.`)
          setNotice('Authorize this existing transaction in your wallet. This signature does not send another payment.')
          return signMessageAsync({ account: payer as Address, message })
        },
        verify: async (reserved, txHash, signature) => {
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const response = await api(checkout.funding_url, 'POST', {
              intent_id: reserved.id, chain_id: reserved.chain_id, token_address: reserved.token_address,
              payer_address: reserved.payer_address, tx_hash: txHash, payer_signature: signature,
            })
            const result = await response.json().catch(() => ({}))
            if (response.ok) return result as FundingResult
            if (!result.retryable) throw new Error(result.error || `Verification failed (${response.status}). Resume this transaction; do not pay again.`)
            setNotice('Transaction saved. Waiting for network confirmation; do not pay again.')
            if (attempt < 19) await new Promise((resolve) => window.setTimeout(resolve, 3000))
          }
          throw new Error('Confirmation is taking longer than expected. Resume verification below; your transaction is saved.')
        },
      })
      setNotice(fundingNotice(result))
      setTerminal(['funded', 'refunded'].includes(fundingOutcome(result)))
      try { await onUpdated?.(result) }
      catch { setNotice(`${fundingNotice(result)} Could not refresh the page; reload to view the current trade.`) }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Wallet operation failed. Check wallet history before continuing.') }
    finally { running.current = false; setBusy(false) }
  }

  async function cancel() {
    if (running.current || intent || saved) return
    if (!window.confirm('Cancel this unpaid reservation? Do not cancel after sending payment.')) return
    running.current = true; setBusy(true)
    try {
      const response = await api(`/api/trades/${tradeId}/cancel`, 'POST', {})
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not cancel the reservation')
      setTerminal(true); setNotice('Reservation cancelled and inventory released.')
      await onUpdated?.()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not cancel reservation') }
    finally { running.current = false; setBusy(false) }
  }

  const txHash = intent?.tx_hash || saved?.txHash
  const recovering = Boolean(intent || saved)
  return <div className="mt-4 border border-border bg-bg/50 p-4 text-sm">
    <p className="font-semibold text-text">{checkout.rail === 'mpp' ? 'Complete the MPP payment' : `Wallet payment · $${checkout.amount_usd.toFixed(2)} total`}</p>
    {checkout.rail === 'mpp' ? <>
      <p className="mt-2 text-text-dim">Use an MPP-aware client to POST to this challenge endpoint with your agent key. The first response is an HTTP 402 pathUSD challenge bound to this trade; retry with the payment credential and the same identity.</p>
      <code className="mt-2 block break-all text-accent">POST {checkout.funding_url}</code>
      <code className="mt-1 block break-all text-accent">X-ClawdMarket-Agent-Key: clawd_…</code>
    </> : <>
      <label className="mt-3 block">Payment token
        <select value={token ? `${token.chain_id}:${token.token_address}` : ''} disabled={busy || recovering || terminal}
          onChange={(event) => setToken(checkout.tokens?.find((item) => `${item.chain_id}:${item.token_address}` === event.target.value) || null)}
          className="mt-1 min-h-11 w-full border border-border bg-bg px-3 py-2">
          {(checkout.tokens || []).map((item) => <option key={`${item.chain_id}:${item.token_address}`} value={`${item.chain_id}:${item.token_address}`}>{item.symbol} · {item.chain_name}</option>)}
        </select>
      </label>
      {intent && <p className="mt-2 break-all text-text-dim">Reserved network: {intent.chain_id} · payer {intent.payer_address}</p>}
      {!isConnected ? <div className="mt-3 flex flex-wrap gap-2">
        {getBrowserWalletConnectors(connectors).map((connector) => <button key={connector.uid} type="button" disabled={connecting || busy} onClick={() => void connectAsync({ connector }).catch((error) => setNotice(formatWalletConnectionError(error, connector.name)))} className="btn-secondary min-h-11 px-3 py-2">Connect {connector.name}</button>)}
      </div> : <p className="mt-3 text-text-dim">Connected {address?.slice(0, 6)}…{address?.slice(-4)}</p>}
      {txHash && <p className="mt-3 break-all">Saved transaction: <code>{txHash}</code></p>}
      {!txHash && <label className="mt-3 block">{recovering ? 'Recover transaction hash from wallet history' : 'Already sent a payment? Enter its transaction hash to recover'}
        <input value={recoveryHash} onChange={(event) => setRecoveryHash(event.target.value)} placeholder="0x…" autoComplete="off" className="mt-1 min-h-11 w-full border border-border bg-bg px-3 py-2" />
        {recovering && <span className="mt-1 block text-text-dim">A payment was started. If its outcome is unknown, find the existing transfer or contact support.</span>}
      </label>}
      {!terminal && <button type="button" disabled={busy || !ready || (closed && !recovering && !recoveryHash) || (!isConnected && !intent?.payer_signature && !saved?.signature) || !token}
        onClick={() => void fund()} className="btn-primary mt-3 min-h-11 px-3 py-2">{busy ? 'Processing…' : recovering || recoveryHash ? 'Resume verification' : `Pay $${checkout.amount_usd.toFixed(2)}`}</button>}
    </>}
    {!recovering && !terminal && !closed && <button type="button" disabled={busy || !ready} onClick={() => void cancel()} className="btn-secondary ml-2 mt-3 min-h-11 px-3 py-2">Cancel unpaid reservation</button>}
    {checkout.expires_at && <p className="mt-2 text-text-dim">Checkout deadline: {new Date(checkout.expires_at).toLocaleString()}</p>}
    {notice && <p className="mt-3 text-text" role="status">{notice}</p>}
  </div>
}
