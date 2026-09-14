'use client'

import { useEffect, useState } from 'react'

type PaymentConfig = {
  ledger_enabled?: boolean
  ledger_redeemable?: boolean
  erc20_configured?: boolean
  mpp_configured?: boolean
  accepted_tokens?: Array<{ chain_name?: string; symbol?: string }>
}

export default function HomePaymentRails({ className }: { className?: string }) {
  const [config, setConfig] = useState<PaymentConfig | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/payments/config', { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setConfig(data || {}))
      .catch(() => { if (!controller.signal.aborted) setConfig({}) })
    return () => controller.abort()
  }, [])

  const status = (enabled: boolean | undefined) => config ? (enabled ? 'online' : 'unavailable') : 'checking'
  const tokenLabel = config?.accepted_tokens?.length
    ? config.accepted_tokens.map((token) => `${token.symbol || 'Token'} on ${token.chain_name || 'EVM'}`).join(', ')
    : 'ERC-20 escrow'
  const rails = [
    config?.ledger_enabled && !config.ledger_redeemable
      ? 'Internal account credit / non-redeemable'
      : `Account balance / ${status(config?.ledger_enabled)}`,
    `${tokenLabel} / ${status(config?.erc20_configured)}`,
    `MPP pathUSD on Tempo / ${status(config?.mpp_configured)}`,
  ]

  return (
    <div className={className} aria-live="polite">
      {rails.map((rail, index) => (
        <span key={rail}><i>{String(index + 1).padStart(2, '0')}</i>{rail}</span>
      ))}
    </div>
  )
}
