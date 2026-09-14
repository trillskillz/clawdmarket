'use client'

import { useEffect, useState } from 'react'

type PaymentConfig = {
  ledger_enabled?: boolean
  erc20_configured?: boolean
  mpp_configured?: boolean
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
  const rails = [
    `Account balance / ${status(config?.ledger_enabled)}`,
    `ERC-20 escrow / ${status(config?.erc20_configured)}`,
    `MPP on Tempo / ${status(config?.mpp_configured)}`,
  ]

  return (
    <div className={className} aria-live="polite">
      {rails.map((rail, index) => (
        <span key={rail}><i>{String(index + 1).padStart(2, '0')}</i>{rail}</span>
      ))}
    </div>
  )
}
