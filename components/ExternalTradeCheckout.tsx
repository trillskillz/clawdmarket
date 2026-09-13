'use client'

import { useState } from 'react'
import { erc20Abi, parseUnits } from 'viem'
import { useAccount, useConnect, useSwitchChain, useWriteContract } from 'wagmi'
import { formatWalletConnectionError, getBrowserWalletConnectors } from '@/lib/wallet-connection'

export type CheckoutToken = {
  chain_id: number
  chain_name: string
  token_address: `0x${string}`
  symbol: string
  decimals: number
  fixed_usd_price: number
}

export type ExternalCheckout = {
  rail: 'mpp' | 'evm'
  funding_url: string
  amount_usd: number
  treasury?: `0x${string}`
  tokens?: CheckoutToken[]
  expires_at?: string | null
}

function csrfToken() {
  return document.cookie.split('; ').find((item) => item.startsWith('csrf-token='))?.split('=')[1] || ''
}

export default function ExternalTradeCheckout({
  tradeId,
  checkout,
  onUpdated,
}: {
  tradeId: string
  checkout: ExternalCheckout
  onUpdated?: () => void | Promise<void>
}) {
  const { address, chainId, isConnected } = useAccount()
  const { connectors, connectAsync, isPending: connecting } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const [token, setToken] = useState<CheckoutToken | null>(checkout.tokens?.[0] || null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  async function fund() {
    if (!checkout.treasury || !token || !address) return
    setBusy(true); setNotice('')
    try {
      if (chainId !== token.chain_id) await switchChainAsync({ chainId: token.chain_id })
      const amount = parseUnits((checkout.amount_usd / token.fixed_usd_price).toFixed(token.decimals), token.decimals)
      const txHash = await writeContractAsync({
        chainId: token.chain_id,
        address: token.token_address,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [checkout.treasury, amount],
      })
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const response = await fetch(checkout.funding_url, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
          body: JSON.stringify({ chain_id: token.chain_id, token_address: token.token_address, tx_hash: txHash, payer_address: address }),
        })
        const result = await response.json().catch(() => ({}))
        if (response.ok) {
          setNotice(result.status?.includes('refund') ? 'The reservation closed while payment confirmed. Your full refund is processing.' : 'Payment verified. The seller can begin work.')
          await onUpdated?.()
          return
        }
        if (result.retryable && attempt < 39) {
          await new Promise((resolve) => window.setTimeout(resolve, 3_000))
          continue
        }
        throw new Error(result.error || `Payment verification failed (${response.status})`)
      }
      throw new Error('Confirmation is taking longer than expected. Keep the transaction hash and retry this checkout.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Wallet payment failed.')
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (!window.confirm('Cancel this unpaid reservation? Do not cancel after broadcasting a wallet transfer. A late verified payment will be refunded automatically.')) return
    setBusy(true); setNotice('')
    try {
      const response = await fetch(`/api/trades/${tradeId}/cancel`, {
        method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrfToken() },
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Could not cancel the reservation')
      setNotice('Reservation cancelled and inventory released.')
      await onUpdated?.()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not cancel the reservation.')
    } finally {
      setBusy(false)
    }
  }

  if (checkout.rail === 'mpp') {
    return <div className="mt-4 border border-border bg-bg/50 p-4 text-xs">
      <p className="font-semibold text-text">Complete the MPP payment</p>
      <p className="mt-2 text-text-dim">Use an MPP-aware client to POST to this challenge endpoint. The pathUSD request is bound to this trade.</p>
      <code className="mt-2 block break-all text-accent">POST {checkout.funding_url}</code>
      {checkout.expires_at && <p className="mt-2 text-text-dim">Expires {new Date(checkout.expires_at).toLocaleString()}</p>}
      <button type="button" disabled={busy} onClick={cancel} className="btn-secondary mt-3 px-3 py-1.5 text-xs">Cancel unpaid reservation</button>
      {notice && <p className="mt-2 text-text-dim" role="status">{notice}</p>}
    </div>
  }

  return <div className="mt-4 border border-border bg-bg/50 p-4 text-xs">
    <p className="font-semibold text-text">Complete ${checkout.amount_usd.toFixed(2)} wallet payment</p>
    <select
      value={token ? `${token.chain_id}:${token.token_address}` : ''}
      onChange={(event) => setToken(checkout.tokens?.find((item) => `${item.chain_id}:${item.token_address}` === event.target.value) || null)}
      className="mt-3 w-full border border-border bg-bg px-3 py-2"
    >
      {(checkout.tokens || []).map((item) => <option key={`${item.chain_id}:${item.token_address}`} value={`${item.chain_id}:${item.token_address}`}>{item.symbol} · {item.chain_name}</option>)}
    </select>
    {!isConnected
      ? <div className="mt-3 flex flex-wrap gap-2">{getBrowserWalletConnectors(connectors).map((connector) => <button key={connector.uid} type="button" disabled={connecting || busy} onClick={() => void connectAsync({ connector }).catch((error) => setNotice(formatWalletConnectionError(error, connector.name)))} className="btn-secondary px-3 py-1.5 text-xs">Connect {connector.name}</button>)}</div>
      : <p className="mt-3 text-text-dim">Connected {address?.slice(0, 6)}…{address?.slice(-4)}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={busy || !isConnected || !token} onClick={() => void fund()} className="btn-primary px-3 py-1.5 text-xs">{busy ? 'Confirming…' : `Pay $${checkout.amount_usd.toFixed(2)}`}</button>
      <button type="button" disabled={busy} onClick={cancel} className="btn-secondary px-3 py-1.5 text-xs">Cancel reservation</button>
    </div>
    {checkout.expires_at && <p className="mt-2 text-text-dim">Expires {new Date(checkout.expires_at).toLocaleString()}</p>}
    {notice && <p className="mt-2 text-text-dim" role="status">{notice}</p>}
  </div>
}
