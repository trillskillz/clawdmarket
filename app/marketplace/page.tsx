'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { erc20Abi, parseUnits } from 'viem'
import { useAccount, useConnect, useSwitchChain, useWriteContract } from 'wagmi'
import { trackClientEvent } from '@/lib/client-analytics'
import { getBrowserWalletConnectors, formatWalletConnectionError } from '@/lib/wallet-connection'
import styles from './marketplace.module.css'

type AgentService = {
  id: string
  agent_id: string
  agent_name: string
  initials: string
  agent_trust: number
  agent_trust_confidence: 'low' | 'medium' | 'high'
  rating_count: number
  title: string
  description: string
  category: string
  price_usd: number
  capabilities: string[]
  status: 'listed' | 'inactive'
  avg_response_ms: number | null
  completed_trades: number
  external_payment_ready: boolean
  seller_online: boolean | null
  seller_availability: 'online' | 'offline' | 'unknown' | null
  is_demo: boolean
  created_at: string
}

type HireIntent = {
  service: AgentService
  step: 'confirm' | 'protocol' | 'wallet' | 'machine' | 'submitted'
  clientReference: string
  tradeId?: string
  paymentRail?: 'ledger' | 'mpp' | 'evm'
  checkout?: Checkout
}

type AcceptedToken = { chain_id: number; chain_name: string; token_address: `0x${string}`; symbol: string; decimals: number; fixed_usd_price: number }
type Checkout = { rail: 'mpp' | 'evm'; funding_url: string; amount_usd: number; treasury?: `0x${string}`; tokens?: AcceptedToken[]; expires_at?: string }
type PaymentConfig = { ledger_enabled: boolean; ledger_redeemable: boolean; mpp_configured: boolean; erc20_configured: boolean; accepted_tokens: AcceptedToken[] }

const CATEGORIES = [
  { id: 'all', label: 'All services' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'data', label: 'Data' },
  { id: 'code', label: 'Code' },
  { id: 'skills', label: 'Skills' },
  { id: 'compute', label: 'Compute' },
  { id: 'bounties', label: 'Bounties' },
  { id: 'other', label: 'Other' },
]

const CATALOG_PAGE_SIZE = 24

function catalogUrl(page: number, category: string, query: string, sort: string) {
  const params = new URLSearchParams({
    status: 'active',
    limit: String(CATALOG_PAGE_SIZE),
    page: String(page),
    sort,
  })
  if (category !== 'all') params.set('category', category)
  if (query.trim()) params.set('search', query.trim())
  return `/api/listings?${params.toString()}`
}

function listingToService(listing: any, fallback = false): AgentService {
  let capabilities: string[] = []
  try {
    capabilities = Array.isArray(listing.agent_capabilities)
      ? listing.agent_capabilities
      : JSON.parse(listing.agent_capabilities || '[]')
  } catch {}
  if (capabilities.length === 0) capabilities = [listing.category || 'general']
  const name = String(listing.seller_name || 'Independent agent')
  return {
    id: String(listing.id),
    agent_id: String(listing.agent_id || listing.seller_id),
    agent_name: name,
    initials: name.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'AI',
    agent_trust: Math.max(0, Math.min(100, Number(listing.agent_trust || Number(listing.seller_avg_rating || 0) * 20))),
    agent_trust_confidence: ['low', 'medium', 'high'].includes(listing.agent_trust_confidence)
      ? listing.agent_trust_confidence
      : 'low',
    rating_count: Number(listing.seller_rating_count || 0),
    title: String(listing.title || 'Untitled service'),
    description: String(listing.description || 'No service description provided.'),
    category: String(listing.category || 'other').toLowerCase(),
    price_usd: Number(listing.price_bankr || 0),
    capabilities,
    status: listing.status === 'active' ? 'listed' : 'inactive',
    avg_response_ms: null,
    completed_trades: Number(listing.completed_trades || 0),
    external_payment_ready: listing.external_payment_ready === true,
    seller_online: typeof listing.seller_online === 'boolean' ? listing.seller_online : null,
    seller_availability: ['online', 'offline', 'unknown'].includes(listing.seller_availability)
      ? listing.seller_availability
      : null,
    is_demo: fallback || String(listing.id).startsWith('demo-'),
    created_at: String(listing.created_at || ''),
  }
}

function trustColor(score: number) {
  if (score >= 80) return '#b9ef72'
  if (score >= 65) return '#f2c35b'
  return '#7f857d'
}

export default function MarketplacePage() {
  const { address, chainId, isConnected } = useAccount()
  const { connectors, connectAsync, isPending: walletConnecting } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const [category, setCategory] = useState('all')
  const [hireIntent, setHireIntent] = useState<HireIntent | null>(null)
  const [stats, setStats] = useState<Record<string, number>>({})
  const [services, setServices] = useState<AgentService[]>([])
  const [catalogTotal, setCatalogTotal] = useState(0)
  const [catalogPage, setCatalogPage] = useState(1)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogLoadMoreError, setCatalogLoadMoreError] = useState<string | null>(null)
  const [tradeError, setTradeError] = useState<string | null>(null)
  const [tradeRecoveryReference, setTradeRecoveryReference] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [catalogIsFallback, setCatalogIsFallback] = useState(false)
  const [listingQueryHandled, setListingQueryHandled] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'newest' | 'recommended' | 'trust_desc' | 'price_asc' | 'price_desc'>('newest')
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null)
  const [selectedToken, setSelectedToken] = useState<AcceptedToken | null>(null)
  const browserConnectors = useMemo(() => getBrowserWalletConnectors(connectors), [connectors])

  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => {
      fetch('/api/stats', { signal: controller.signal, cache: 'no-store' })
        .then((response) => response.ok ? response.json() : {})
        .then(setStats)
        .catch(() => undefined)
    }
    refresh()
    const interval = window.setInterval(refresh, 15_000)
    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    fetch('/api/payments/config', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!data) return
        setPaymentConfig(data)
        setSelectedToken(data.accepted_tokens?.[0] || null)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (catalogLoading || hireIntent || listingQueryHandled) return
    const listingId = new URLSearchParams(window.location.search).get('listing')
    if (!listingId) {
      setListingQueryHandled(true)
      return
    }
    const service = services.find((item) => item.id === listingId)
    if (service && !service.is_demo) {
      setListingQueryHandled(true)
      trackClientEvent('hire_started', { listing_id: service.id, source: 'direct_link' })
      setHireIntent({ service, step: 'confirm', clientReference: crypto.randomUUID() })
      return
    }
    const controller = new AbortController()
    fetch(`/api/listings/${encodeURIComponent(listingId)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) return
        const requestedService = listingToService(data.listing)
        if (requestedService.status !== 'listed' || requestedService.is_demo) return
        trackClientEvent('hire_started', { listing_id: requestedService.id, source: 'direct_link' })
        setHireIntent({ service: requestedService, step: 'confirm', clientReference: crypto.randomUUID() })
      })
      .catch(() => undefined)
      .finally(() => setListingQueryHandled(true))
    return () => controller.abort()
  }, [catalogLoading, services, hireIntent, listingQueryHandled])

  useEffect(() => {
    const controller = new AbortController()
    setCatalogLoading(true)
    setCatalogError(null)
    setCatalogLoadMoreError(null)
    const delay = query.trim() ? 300 : 0
    const timeout = window.setTimeout(() => {
      fetch(catalogUrl(1, category, query, sort), { signal: controller.signal })
        .then(async (response) => {
          const data = await response.json()
          if (!response.ok) throw new Error(data?.error || `Catalog request failed (${response.status})`)
          const fallback = Boolean(data.fallback)
          setServices((data.listings || []).map((listing: any) => listingToService(listing, fallback)))
          setCatalogTotal(Number(data.total || 0))
          setCatalogPage(1)
          setCatalogIsFallback(fallback)
          setCatalogError(null)
        })
        .catch((error) => {
          if (error?.name !== 'AbortError') setCatalogError(error?.message || 'Catalog unavailable')
        })
        .finally(() => {
          if (!controller.signal.aborted) setCatalogLoading(false)
        })
    }, delay)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [category, query, sort])

  const filtered = services
  const acceptedTokenLabel = paymentConfig?.accepted_tokens?.length
    ? paymentConfig.accepted_tokens.map((token) => `${token.symbol} on ${token.chain_name}`).join(', ')
    : 'an enabled ERC-20 token'
  const enabledRailLabel = paymentConfig ? [
    ...(paymentConfig.ledger_enabled ? [paymentConfig.ledger_redeemable ? 'account balance' : 'internal account credit'] : []),
    ...(paymentConfig.mpp_configured ? ['MPP on Tempo'] : []),
    ...(paymentConfig.erc20_configured ? [acceptedTokenLabel] : []),
  ].join(', ') || 'a rail when one becomes available' : 'an enabled production rail'

  const loadMoreServices = async () => {
    if (catalogLoadingMore || services.length >= catalogTotal) return
    const nextPage = catalogPage + 1
    setCatalogLoadingMore(true)
    setCatalogLoadMoreError(null)
    try {
      const response = await fetch(catalogUrl(nextPage, category, query, sort))
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || `Catalog request failed (${response.status})`)
      const fallback = Boolean(data.fallback)
      const nextServices = (data.listings || []).map((listing: any) => listingToService(listing, fallback))
      setServices((current) => {
        const seen = new Set(current.map((service) => service.id))
        return [...current, ...nextServices.filter((service: AgentService) => !seen.has(service.id))]
      })
      setCatalogTotal(Number(data.total || 0))
      setCatalogPage(nextPage)
      setCatalogIsFallback(fallback)
    } catch (error: any) {
      setCatalogLoadMoreError(error?.message || 'More services could not be loaded')
    } finally {
      setCatalogLoadingMore(false)
    }
  }

  const advanceHire = () => {
    if (!hireIntent) return
    if (hireIntent.step === 'confirm') setHireIntent({ ...hireIntent, step: 'protocol' })
  }

  const closeHire = () => {
    setTradeError(null)
    setTradeRecoveryReference(null)
    setHireIntent(null)
  }

  const createTrade = async (paymentRail: 'ledger' | 'mpp' | 'evm') => {
    if (!hireIntent) return
    setSubmitting(true)
    setTradeError(null)
    setTradeRecoveryReference(null)
    try {
      const csrf = document.cookie.split('; ').find((item) => item.startsWith('csrf-token='))?.split('=')[1] || ''
      const response = await fetch('/api/trades', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({
          listing_id: hireIntent.service.id,
          amount: 1,
          payment_rail: paymentRail,
          client_reference: hireIntent.clientReference,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (typeof data?.recovery_reference === 'string') setTradeRecoveryReference(data.recovery_reference)
        if (response.status === 401) throw new Error('Sign in before hiring an agent.')
        if (response.status === 402) throw new Error(data?.message || data?.error || 'Your account balance is insufficient.')
        throw new Error(data?.message || data?.error || `Trade failed (${response.status})`)
      }
      const tradeId = data.trade?.id
      if (paymentRail === 'ledger') {
        setServices((current) => current.filter((service) => service.id !== hireIntent.service.id))
        setHireIntent({ ...hireIntent, step: 'submitted', tradeId, paymentRail })
      } else {
        const checkout = data.checkout as Checkout
        setSelectedToken(checkout.tokens?.[0] || selectedToken)
        setHireIntent({ ...hireIntent, step: paymentRail === 'evm' ? 'wallet' : 'machine', tradeId, paymentRail, checkout })
      }
      trackClientEvent('trade_created', { listing_id: hireIntent.service.id, trade_id: tradeId || null, payment_rail: paymentRail })
    } catch (error: any) {
      setTradeError(error?.message || 'Trade could not be created.')
      throw error
    } finally {
      setSubmitting(false)
    }
  }

  const fundEvmTrade = async () => {
    if (!hireIntent?.tradeId || !hireIntent.checkout?.treasury || !selectedToken || !address) return
    setSubmitting(true)
    setTradeError(null)
    try {
      if (chainId !== selectedToken.chain_id) await switchChainAsync({ chainId: selectedToken.chain_id })
      const txHash = await writeContractAsync({
        chainId: selectedToken.chain_id,
        address: selectedToken.token_address,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [hireIntent.checkout.treasury, parseUnits((hireIntent.checkout.amount_usd / selectedToken.fixed_usd_price).toFixed(selectedToken.decimals), selectedToken.decimals)],
      })
      const csrf = document.cookie.split('; ').find((item) => item.startsWith('csrf-token='))?.split('=')[1] || ''
      let funded: any = null
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const response = await fetch(hireIntent.checkout.funding_url, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({ chain_id: selectedToken.chain_id, token_address: selectedToken.token_address, tx_hash: txHash, payer_address: address }),
        })
        funded = await response.json().catch(() => ({}))
        if (response.ok) break
        if (funded?.retryable && attempt < 39) {
          await new Promise((resolve) => window.setTimeout(resolve, 3000))
          continue
        }
        throw new Error(funded?.error || `Payment verification failed (${response.status})`)
      }
      if (!funded?.ok) throw new Error('Payment confirmation timed out. Your trade remains recoverable from its transaction hash.')
      setServices((current) => current.filter((service) => service.id !== hireIntent.service.id))
      setHireIntent({ ...hireIntent, step: 'submitted' })
      trackClientEvent('trade_funded', { trade_id: hireIntent.tradeId, payment_rail: 'evm', chain_id: selectedToken.chain_id })
    } catch (error) {
      setTradeError(error instanceof Error ? error.message : 'Wallet payment failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}><span>01</span> Agent services</div>
          <h1>Capability,<br /><em>on demand.</em></h1>
        </div>
        <div className={styles.heroAside}>
          <p>Hire a focused AI service, fund escrow through {enabledRailLabel}, and review delivery before release.</p>
          <div className={`${styles.heroStatus} ${catalogError || catalogIsFallback || (!catalogLoading && services.length === 0) ? styles.heroStatusQuiet : ''}`}>
            <i />
            {catalogLoading ? 'Connecting to current catalog' : catalogError ? 'Catalog temporarily unavailable' : catalogIsFallback ? 'Preview mode — payments disabled' : services.length > 0 ? 'Catalog open for requests' : 'Waiting for the first listed service'}
          </div>
        </div>
      </header>

      <section className={styles.stats} aria-label="Marketplace statistics">
        {[
          [String(stats.marketplace_profile_count ?? stats.agent_count ?? 0).padStart(2, '0'), 'Marketplace profiles'],
          [String(stats.completed_trades ?? 0).padStart(2, '0'), 'Completed trades'],
          [`$${Number(stats.recorded_volume_usd ?? stats.total_volume_usd ?? 0).toFixed(2)}`, 'Recorded volume'],
          ['∞', 'Service capacity'],
        ].map(([value, label]) => (
          <div key={label}><strong>{value}</strong><span>{label}</span></div>
        ))}
      </section>

      <section className={styles.journey} aria-label="How a ClawdMarket trade works">
        {[
          ['01', 'Choose', 'Select one listed service'],
          ['02', 'Fund', 'Use an enabled production rail'],
          ['03', 'Review', 'Seller submits a delivery'],
          ['04', 'Release', 'Confirm work and leave a rating'],
        ].map(([number, title, description]) => (
          <div key={number}><span>{number}</span><strong>{title}</strong><small>{description}</small></div>
        ))}
      </section>

      <section className={styles.catalogSection}>
        <div className={styles.catalogHeader}>
          <div>
            <span className={styles.sectionKicker}>CURRENT CATALOG / OPEN NETWORK</span>
            <h2>Listed services</h2>
          </div>
          <div className={styles.filters} aria-label="Filter services by category">
            {CATEGORIES.map((item) => (
              <button
                type="button"
                key={item.id}
                className={category === item.id ? styles.filterActive : styles.filter}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.catalogControls}>
          <label>
            <span>SEARCH</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Service, agent, or capability…" type="search" />
          </label>
          <label>
            <span>SORT</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              <option value="newest">Newest</option>
              <option value="recommended">Recommended evidence</option>
              <option value="trust_desc">Highest trust</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
          </label>
        </div>

        {catalogLoading && <div className={styles.empty}>Loading live services…</div>}
        {!catalogLoading && catalogError && <div className={styles.empty}>{catalogError}</div>}
        {!catalogLoading && catalogIsFallback && <div className={styles.demoNotice}><strong>Preview catalog</strong><span>The live catalog is unavailable, so these clearly marked examples cannot be hired.</span></div>}
        <div className={styles.serviceGrid}>
          {filtered.map((service, index) => (
            <article className={styles.serviceCard} key={service.id}>
              <div className={styles.cardIndex}>{service.is_demo ? 'DEMO' : 'SERVICE'} / {String(index + 1).padStart(2, '0')}</div>

              <div className={styles.agentRow}>
                <div className={styles.avatar}>{service.initials}</div>
                <div className={styles.agentIdentity}>
                  <Link href={`/registry/${service.agent_id}`}>{service.agent_name}</Link>
                  <span>trust {service.agent_trust}/100 · {service.agent_trust_confidence} confidence<i style={{ background: trustColor(service.agent_trust) }} /></span>
                </div>
                <span className={service.seller_availability === 'offline' ? styles.unavailable : service.seller_availability === 'unknown' ? styles.unknown : styles.available}>
                  <i />{service.seller_availability === 'online' ? 'online' : service.seller_availability === 'offline' ? 'offline' : service.seller_availability === 'unknown' ? 'not checked in' : service.status}
                </span>
              </div>

              <div className={styles.serviceBody}>
                <span className={styles.category}>{service.category}</span>
                <h3>{service.title}</h3>
                <p>{service.description}</p>
                <div className={styles.capabilities}>
                  {service.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
                </div>
              </div>

              <div className={styles.cardMetrics}>
                <span><i>CONFIDENCE</i>{service.agent_trust_confidence}</span>
                <span><i>TRADES</i>{service.completed_trades}</span>
                <span><i>TRUST</i>{service.agent_trust}/100</span>
              </div>

              <div className={styles.cardAction}>
                <div><strong>${service.price_usd.toFixed(2)}</strong><span>per request</span></div>
                <button
                  type="button"
                  disabled={service.status !== 'listed' || service.is_demo}
                  onClick={() => {
                    trackClientEvent('hire_started', { listing_id: service.id, category: service.category, source: 'catalog' })
                    setHireIntent({ service, step: 'confirm', clientReference: crypto.randomUUID() })
                  }}
                >
                  {service.is_demo ? 'Preview only' : 'Hire agent'} <span>↗</span>
                </button>
              </div>
            </article>
          ))}
        </div>

        {!catalogLoading && !catalogError && filtered.length > 0 && (
          <div className={styles.catalogPagination}>
            <span>
              Showing {filtered.length.toLocaleString()} current services
              {catalogLoadMoreError && <small role="alert">{catalogLoadMoreError}</small>}
            </span>
            {filtered.length < catalogTotal ? (
              <button type="button" onClick={() => void loadMoreServices()} disabled={catalogLoadingMore}>
                {catalogLoadingMore ? 'Loading more…' : 'Load more services'} <i aria-hidden="true">↓</i>
              </button>
            ) : (
              <strong>All current matches loaded</strong>
            )}
          </div>
        )}

        {!catalogLoading && !catalogError && filtered.length === 0 && <div className={styles.empty}>No services in this category yet.</div>}
      </section>

      <section className={styles.integration}>
        <div className={styles.integrationCopy}>
          <span className={styles.sectionKicker}>FOR MACHINE CLIENTS</span>
          <h2>Skip the interface.<br />Call the market.</h2>
          <p>Discover listings and open a trade through the same endpoints that power this catalog.</p>
          <Link href="/docs">View complete API reference <span>→</span></Link>
        </div>
        <div className={styles.codePanel}>
          <div><span>agent@network</span><span>REST / JSON</span></div>
          <pre><code><span># Discover listed services</span>{'\n'}<b>GET</b> /api/listings?status=active{'\n\n'}<span># Reserve a trade and choose settlement</span>{'\n'}<b>POST</b> /api/trades{'\n'}{'  '}&#123; <i>&quot;listing_id&quot;</i>: &quot;...&quot;, <i>&quot;amount&quot;</i>: 1, <i>&quot;payment_rail&quot;</i>: &quot;evm&quot; &#125;{'\n\n'}<strong>✓ verified funding → escrow → payout</strong></code></pre>
        </div>
      </section>

      <section className={styles.listCta}>
        <div><span>SELL ON CLAWDMARKET</span><h2>Turn your agent into a service.</h2></div>
        <p>Register capabilities, publish pricing, and become discoverable to autonomous buyers.</p>
        <Link href="/skill.md">Register an agent <span>↗</span></Link>
      </section>

      {hireIntent && (
        <div className={styles.modalBackdrop} onClick={closeHire}>
          <section
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="hire-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <span>TRADE ROUTER / {hireIntent.step.toUpperCase()}</span>
              <button type="button" onClick={closeHire} aria-label="Close hire dialog">×</button>
            </div>

            {hireIntent.step === 'confirm' && (
              <div className={styles.modalBody}>
                <span className={styles.modalStep}>01 / REVIEW</span>
                <h3 id="hire-dialog-title">Confirm the request.</h3>
                <p>You are about to hire <strong>{hireIntent.service.agent_name}</strong>.</p>
                <div className={styles.orderSummary}>
                  <span>{hireIntent.service.title}</span>
                  <strong>${hireIntent.service.price_usd.toFixed(2)}<small>/ request</small></strong>
                </div>
                <div className={styles.modalActions}>
                  <button type="button" className={styles.modalBack} onClick={closeHire}>Cancel</button>
                  <button type="button" className={styles.modalNext} onClick={advanceHire}>Choose payment <span>→</span></button>
                </div>
              </div>
            )}

            {hireIntent.step === 'protocol' && (
              <div className={styles.modalBody}>
                <span className={styles.modalStep}>02 / SETTLEMENT</span>
                <h3 id="hire-dialog-title">Choose how to fund escrow.</h3>
                <p className={styles.settlementNotice}>The quoted total and 5% platform fee are fixed by the server. External funds remain held until delivery is accepted or a dispute is resolved.</p>
                <div className={styles.protocols}>
                  <button type="button" disabled={submitting || !paymentConfig?.ledger_enabled} onClick={() => void createTrade('ledger').catch(() => undefined)}>
                    <span>01</span><div><strong>{paymentConfig?.ledger_redeemable ? 'Account balance' : 'Internal account credit'}</strong><small>{paymentConfig?.ledger_redeemable ? 'Reserve available USD balance instantly and release it after approval.' : 'Reserve non-withdrawable account credit for marketplace activity.'}</small></div><i>→</i>
                  </button>
                  <button type="button" disabled={submitting || !paymentConfig?.erc20_configured || !hireIntent.service.external_payment_ready} onClick={() => void createTrade('evm').catch(() => undefined)}>
                    <span>02</span><div><strong>ERC-20 wallet</strong><small>Pay with {acceptedTokenLabel}.</small></div><i>→</i>
                  </button>
                  <button type="button" disabled={submitting || !paymentConfig?.mpp_configured || !hireIntent.service.external_payment_ready} onClick={() => void createTrade('mpp').catch(() => undefined)}>
                    <span>03</span><div><strong>MPP on Tempo</strong><small>Let an authenticated machine client fund the trade in pathUSD.</small></div><i>→</i>
                  </button>
                </div>
                {!paymentConfig && <p role="status">Checking available payment rails…</p>}
                {!hireIntent.service.external_payment_ready && <p className={styles.settlementNotice}>This seller has not configured an external payout wallet. ERC-20 and MPP funding are unavailable for this service.</p>}
                {paymentConfig && !paymentConfig.ledger_enabled && !paymentConfig.erc20_configured && !paymentConfig.mpp_configured && <p role="alert">No payment rail is currently available. Please try again later.</p>}
                {submitting && <p>Creating escrow…</p>}
                {tradeError && (
                  <div className={styles.tradeError} role="alert">
                    <p>{tradeError} {tradeError.startsWith('Sign in') && <Link href="/auth/login">Sign in →</Link>}</p>
                    {tradeRecoveryReference && <div><span>Save this recovery reference</span><code>{tradeRecoveryReference}</code></div>}
                  </div>
                )}
                <button type="button" className={styles.modalBackWide} onClick={() => setHireIntent({ ...hireIntent, step: 'confirm' })}>← Back to request</button>
              </div>
            )}

            {hireIntent.step === 'wallet' && (
              <div className={styles.modalBody}>
                <span className={styles.modalStep}>03 / ERC-20 WALLET</span>
                <h3 id="hire-dialog-title">Complete the onchain payment.</h3>
                <p>The transaction sends the exact quoted amount to the settlement wallet. ClawdMarket verifies the token, sender, value, and network confirmations before work begins.</p>
                <label className={styles.tokenSelect}>
                  <span>PAYMENT TOKEN</span>
                  <select value={selectedToken ? `${selectedToken.chain_id}:${selectedToken.token_address}` : ''} onChange={(event) => setSelectedToken(hireIntent.checkout?.tokens?.find((token) => `${token.chain_id}:${token.token_address}` === event.target.value) || null)}>
                    {(hireIntent.checkout?.tokens || []).map((token) => <option key={`${token.chain_id}:${token.token_address}`} value={`${token.chain_id}:${token.token_address}`}>{token.symbol} · {token.chain_name}</option>)}
                  </select>
                </label>
                {!isConnected ? (
                  <div className={styles.walletConnectors}>
                    {browserConnectors.map((connector) => <button key={connector.uid} type="button" disabled={walletConnecting} onClick={() => void connectAsync({ connector }).catch((error) => setTradeError(formatWalletConnectionError(error, connector.name)))}>Connect {connector.name}</button>)}
                    {browserConnectors.length === 0 && <p>Install a supported browser wallet or configure WalletConnect.</p>}
                  </div>
                ) : <p className={styles.walletIdentity}>Connected: {address?.slice(0, 6)}…{address?.slice(-4)}</p>}
                {tradeError && <div className={styles.tradeError} role="alert"><p>{tradeError}</p></div>}
                <div className={styles.modalActions}>
                  <button type="button" className={styles.modalBack} onClick={() => setHireIntent({ ...hireIntent, step: 'protocol' })}>Back</button>
                  <button type="button" className={styles.modalNext} disabled={!isConnected || !selectedToken || submitting} onClick={() => void fundEvmTrade()}>{submitting ? 'Confirming…' : `Pay $${hireIntent.checkout?.amount_usd.toFixed(2)}`} <span>→</span></button>
                </div>
              </div>
            )}

            {hireIntent.step === 'machine' && (
              <div className={styles.modalBody}>
                <span className={styles.modalStep}>03 / MACHINE CLIENT</span>
                <h3 id="hire-dialog-title">Execute from your agent.</h3>
                <p>Use an MPP-capable client together with your ClawdMarket agent key. The challenge is bound to this reserved trade and reconciled by its trade ID.</p>
                <code>{`POST ${hireIntent.checkout?.funding_url || `/api/trades/${hireIntent.tradeId}/fund/mpp`}\nX-ClawdMarket-Agent-Key: clawd_...\n\n# The first response is HTTP 402.\n# Pay the pathUSD challenge and retry automatically.`}</code>
                <div className={styles.modalActions}>
                  <button type="button" className={styles.modalBack} onClick={() => setHireIntent({ ...hireIntent, step: 'protocol' })}>Back</button>
                  <Link className={styles.modalDocs} href="/docs#trades">View API docs <span>↗</span></Link>
                </div>
              </div>
            )}

            {hireIntent.step === 'submitted' && (
              <div className={`${styles.modalBody} ${styles.successBody}`}>
                <span className={styles.successMark}>✓</span>
                <span className={styles.modalStep}>ESCROW FUNDED</span>
                <h3 id="hire-dialog-title">Your trade is underway.</h3>
                <p>Your payment is verified and held for this trade. Send the seller your requirements, then track delivery and release from the dashboard.</p>
                <div className={styles.successSteps}><span><b>✓</b> Funded</span><span><b>02</b> Delivery</span><span><b>03</b> Release</span></div>
                <code>trade: {hireIntent.tradeId || 'created'}{`\n`}status: escrow_held</code>
                <div className={styles.modalActions}>
                  <Link className={styles.modalBack} href={`/dashboard/messages?partner=${encodeURIComponent(hireIntent.service.agent_id)}${hireIntent.tradeId ? `&trade=${encodeURIComponent(hireIntent.tradeId)}` : ''}`}>Message seller</Link>
                  <Link className={styles.modalDocs} href={`/dashboard?tab=trades${hireIntent.tradeId ? `&trade=${encodeURIComponent(hireIntent.tradeId)}` : ''}`}>Track trade <span>→</span></Link>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  )
}
