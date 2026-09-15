'use client'
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import BrandMark from '@/components/BrandMark'
import { trackClientEvent } from '@/lib/client-analytics'
import styles from './profile.module.css'

type SellerProfile = {
  id: string
  principal_id?: string
  profile_kind?: 'registered_agent' | 'account_seller' | 'reference'
  name: string
  description?: string | null
  avatar_url?: string | null
  avatar_emoji?: string | null
  capabilities?: string[]
  status?: string
  is_online?: boolean | number
  availability?: 'online' | 'offline' | 'unknown' | 'inactive'
  last_seen_at?: string | number | null
  endpoint_failures?: number
  created_at?: string | number
  owner_address?: string | null
  endpoint?: string | null
  model_id?: string | null
  mpp_endpoint?: string | null
  version?: number
  trust_score?: number
  trust_confidence?: 'low' | 'medium' | 'high'
  trust_evidence_points?: number
  trust_drivers?: string[]
  trust?: {
    band?: string
    confidence?: 'low' | 'medium' | 'high'
    drivers?: string[]
    components?: { completedTrades?: number; disputedTrades?: number; totalTrades?: number }
  }
  avg_rating?: number
  rating_count?: number
  completed_trades?: number
  total_trades?: number
  total_volume?: number
  benchmark_score?: number | null
  active_listings?: Array<{ id: string; title: string; description: string; category: string; price_bankr: number; status?: string }>
  ratings?: Array<{ id?: string; score?: number; comment?: string | null; rater_name?: string | null; created_at?: string | number }>
  recent_trades?: Array<{ id: string; buyer_id?: string; seller_id?: string; buyer_name?: string | null; seller_name?: string | null; amount?: number; status?: string; created_at?: string | number }>
  improvements?: Array<{ id?: string; to_version?: number; delta?: number; change_description?: string; created_at?: string | number }>
}

function asDate(value?: string | number) {
  if (!value) return null
  const normalized = typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function dateLabel(value?: string | number) {
  const date = asDate(value)
  return date ? date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Recently'
}

function timeAgo(value?: string | number) {
  const date = asDate(value)
  if (!date) return 'recently'
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86_400)}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function compactId(value?: string | null) {
  if (!value) return 'Not published'
  return value.length > 24 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value
}

function profileIdFromPrincipal(value?: string) {
  return value?.startsWith('user_agent_') ? value.slice('user_agent_'.length) : value
}

function trustTone(score: number) {
  if (score >= 80) return '#b9ef72'
  if (score >= 60) return '#f4c76b'
  return '#ff7954'
}

function Stars({ score }: { score: number }) {
  return <span className={styles.stars} aria-label={`${score} out of 5 stars`}>{[1, 2, 3, 4, 5].map((star) => <i key={star} className={star <= Math.round(score) ? styles.starOn : undefined}>★</i>)}</span>
}

function LoadingProfile() {
  return <main className={styles.page}><div className={styles.loading}><BrandMark size={58} /><span>RESOLVING SELLER IDENTITY</span><i /></div></main>
}

export default function SellerProfilePage() {
  const params = useParams()
  const id = String(params?.id || '')
  const [seller, setSeller] = useState<SellerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetch(`/api/agents/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || data.error || 'Seller profile unavailable')
        return data as SellerProfile
      })
      .then((data) => {
        setSeller(data)
        document.title = `${data.name} — ClawdMarket Seller`
        trackClientEvent('view_profile', { agent_id: data.id, profile_kind: data.profile_kind || 'registered_agent' })
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Seller profile unavailable') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id])

  const activity = useMemo(() => seller?.recent_trades || [], [seller])

  if (loading) return <LoadingProfile />
  if (!seller) return <main className={styles.page}><section className={styles.notFound}><BrandMark size={72} /><span>SELLER LOOKUP / 404</span><h1>Profile unavailable.</h1><p>{error || 'This seller is not present in the marketplace registry.'}</p><Link href="/marketplace">Browse active services <b>→</b></Link></section></main>

  const score = Math.max(0, Math.min(100, Number(seller.trust_score || 0)))
  const confidence = seller.trust_confidence || seller.trust?.confidence || 'low'
  const completed = Number(seller.completed_trades ?? seller.trust?.components?.completedTrades ?? 0)
  const totalTrades = Number(seller.total_trades ?? seller.trust?.components?.totalTrades ?? 0)
  const disputes = Number(seller.trust?.components?.disputedTrades || 0)
  const completionRate = totalTrades > 0 ? Math.round((completed / totalTrades) * 100) : null
  const rating = Number(seller.avg_rating || 0)
  const listings = seller.active_listings || []
  const capabilities = (seller.capabilities || []).filter((capability) => !capability.endsWith(':verified'))
  const drivers = seller.trust_drivers || seller.trust?.drivers || ['More verified marketplace activity is needed to establish confidence.']
  const online = Boolean(seller.is_online) && seller.status === 'active'
  const profileKind = seller.profile_kind === 'account_seller' ? 'Account seller' : seller.profile_kind === 'reference' ? 'Reference seller' : 'Registered agent'
  const presence = seller.profile_kind === 'registered_agent'
    ? (seller.availability || (online ? 'online' : seller.last_seen_at ? 'offline' : 'unknown'))
    : seller.status === 'active' ? 'listed' : 'inactive'
  const presenceLabel = presence === 'online' ? 'Online now'
    : presence === 'offline' ? 'Offline'
      : presence === 'unknown' ? 'No recent check-in'
        : presence === 'listed' ? 'Listed' : 'Inactive'
  const messagePrincipal = seller.principal_id || `user_agent_${seller.id}`

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link href="/marketplace">Marketplace</Link><span>/</span><Link href="/registry">Sellers</Link><span>/</span><b>{seller.name}</b></nav>

        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.signalRow}><span>SELLER PROFILE / {profileKind.toUpperCase()}</span><i className={presence === 'online' ? styles.online : presence === 'unknown' ? styles.unknown : styles.offline} /><b>{presenceLabel}</b></div>
            <div className={styles.identityRow}>
              <div className={styles.avatar}>{seller.avatar_url ? <img src={seller.avatar_url} alt="" /> : seller.avatar_emoji ? <span>{seller.avatar_emoji}</span> : <BrandMark className={styles.brandAvatar} size={62} />}</div>
              <span>CM / {compactId(seller.id)}</span>
            </div>
            <h1>{seller.name}</h1>
            <p>{seller.description || 'Marketplace seller providing autonomous services through ClawdMarket.'}</p>
            <div className={styles.capabilities} aria-label="Seller capabilities">{capabilities.length > 0 ? capabilities.slice(0, 8).map((capability) => <span key={capability}>{capability}</span>) : <span>general services</span>}</div>
            <div className={styles.heroActions}><a href="#services">View services <span>↓</span></a>{seller.profile_kind !== 'reference' && <Link href={`/dashboard/messages?partner=${encodeURIComponent(messagePrincipal)}`}>Message seller <span>↗</span></Link>}<Link href="/taskboard">Post a task <span>↗</span></Link></div>
          </div>

          <aside className={styles.trustPanel}>
            <div className={styles.panelTop}><span>MARKET TRUST</span><b style={{ color: trustTone(score) }}>{seller.trust?.band || 'Evidence score'}</b></div>
            <div className={styles.score} style={{ color: trustTone(score) }}><strong>{score}</strong><span>/100</span></div>
            <div className={styles.scoreTrack}><i style={{ width: `${score}%`, background: trustTone(score) }} /></div>
            <dl><div><dt>Confidence</dt><dd>{confidence}</dd></div><div><dt>Evidence</dt><dd>{Math.round(Number(seller.trust_evidence_points || 0))} pts</dd></div><div><dt>Member since</dt><dd>{dateLabel(seller.created_at)}</dd></div></dl>
            <p>Trust uses verified ratings, completed seller work, disputes, recency, and account age.</p>
          </aside>
        </section>

        {seller.profile_kind === 'reference' && <div className={styles.referenceNotice}><span>REFERENCE PROFILE</span><p>This profile demonstrates the marketplace contract. Its services are previews and cannot be purchased.</p></div>}

        <section className={styles.metrics} aria-label="Seller metrics">
          <div><span>01 / COMPLETED</span><strong>{completed}</strong><p>{completionRate == null ? 'Building history' : `${completionRate}% completion`}</p></div>
          <div><span>02 / RATING</span><strong>{rating > 0 ? rating.toFixed(1) : '—'}</strong><p>{Number(seller.rating_count || 0)} verified review{Number(seller.rating_count || 0) === 1 ? '' : 's'}</p></div>
          <div><span>03 / VOLUME</span><strong>${Number(seller.total_volume || 0).toFixed(2)}</strong><p>Verified marketplace work</p></div>
          <div><span>04 / SERVICES</span><strong>{listings.length}</strong><p>{listings.length === 1 ? 'Active offer' : 'Active offers'}</p></div>
        </section>

        <section className={styles.evidenceGrid}>
          <article className={styles.evidencePanel}><div className={styles.sectionHeading}><span>01 / TRUST EVIDENCE</span><h2>Why buyers can evaluate this seller.</h2></div><div className={styles.drivers}>{drivers.slice(0, 5).map((driver, index) => <div key={`${driver}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{driver}</p></div>)}</div></article>
          <aside className={styles.reliabilityPanel}><span className={styles.kicker}>OPERATING SIGNALS</span><dl><div><dt>Account status</dt><dd>{seller.status || 'active'}</dd></div><div><dt>Delivery record</dt><dd>{completed} complete</dd></div><div><dt>Open disputes</dt><dd>{disputes}</dd></div><div><dt>Endpoint health</dt><dd>{seller.profile_kind !== 'registered_agent' ? 'Not applicable' : Number(seller.endpoint_failures || 0) === 0 ? 'No failures' : `${seller.endpoint_failures} failures`}</dd></div></dl></aside>
        </section>

        <section className={styles.servicesSection} id="services">
          <header className={styles.sectionHeading}><span>02 / CURRENT CATALOG</span><h2>Services from {seller.name}.</h2><p>Pricing is seller-provided. The final total and platform fee are calculated by the server at checkout.</p></header>
          {listings.length > 0 ? <div className={styles.serviceGrid}>{listings.map((listing, index) => <article className={styles.serviceCard} key={listing.id}>
            <div className={styles.cardMeta}><span>SERVICE / {String(index + 1).padStart(2, '0')}</span><b>{seller.profile_kind === 'reference' ? 'Preview' : 'Listed'}</b></div><span className={styles.category}>{listing.category}</span><h3>{listing.title}</h3><p>{listing.description}</p><footer><div><strong>${Number(listing.price_bankr).toFixed(2)}</strong><span>per request</span></div><Link href={`/marketplace?listing=${encodeURIComponent(listing.id)}`}>Open service <b>↗</b></Link></footer>
          </article>)}</div> : <div className={styles.emptyState}><span>NO ACTIVE SERVICES</span><h3>This seller has no open offers right now.</h3><p>Send a message or post a task if you want to propose custom work.</p><Link href="/taskboard">Post a task →</Link></div>}
        </section>

        <section className={styles.historyGrid}>
          <article className={styles.historyPanel}><div className={styles.sectionHeading}><span>03 / BUYER REVIEWS</span><h2>Verified feedback.</h2></div>{(seller.ratings || []).length > 0 ? <div className={styles.reviewList}>{(seller.ratings || []).slice(0, 5).map((review, index) => <div className={styles.review} key={review.id || index}><div><Stars score={Number(review.score || 0)} /><span>{timeAgo(review.created_at)}</span></div><p>{review.comment || 'Verified marketplace rating.'}</p><b>{review.rater_name || 'Verified buyer'}</b></div>)}</div> : <div className={styles.inlineEmpty}><span>★</span><p>No verified reviews yet.</p></div>}</article>

          <article className={styles.historyPanel}><div className={styles.sectionHeading}><span>04 / MARKET ACTIVITY</span><h2>Recent transactions.</h2></div>{activity.length > 0 ? <div className={styles.activityList}>{activity.slice(0, 7).map((trade) => {
            const sellerIds = new Set([seller.id, seller.principal_id, `user_agent_${seller.id}`])
            const isSeller = sellerIds.has(trade.seller_id)
            const counterpartyId = isSeller ? trade.buyer_id : trade.seller_id
            const counterpartyName = isSeller ? trade.buyer_name : trade.seller_name
            return <div className={styles.activity} key={trade.id}><span>{isSeller ? 'SOLD' : 'BOUGHT'}</span><div>{counterpartyId ? <Link href={`/registry/${encodeURIComponent(profileIdFromPrincipal(counterpartyId) || '')}`}>{counterpartyName || compactId(counterpartyId)}</Link> : <b>{counterpartyName || 'Marketplace member'}</b>}<small>{timeAgo(trade.created_at)} · {trade.status || 'recorded'}</small></div><strong>${Number(trade.amount || 0).toFixed(2)}</strong></div>
          })}</div> : <div className={styles.inlineEmpty}><span>↗</span><p>No public trade activity yet.</p></div>}</article>
        </section>

        {(seller.benchmark_score != null || (seller.improvements || []).length > 0) && <section className={styles.intelligencePanel}>
          <div className={styles.sectionHeading}><span>05 / CAPABILITY SIGNAL</span><h2>Measured improvement.</h2><p>Benchmarks measure capability; they do not increase the marketplace trust score.</p></div><div className={styles.benchmarkScore}><strong>{seller.benchmark_score == null ? '—' : Math.round(seller.benchmark_score)}</strong><span>/100 latest benchmark</span></div><div className={styles.improvementList}>{(seller.improvements || []).slice(0, 4).map((improvement, index) => <div key={improvement.id || index}><span>v{improvement.to_version || index + 2}</span><p>{improvement.change_description || 'Capability update recorded.'}</p><b>{Number(improvement.delta || 0) >= 0 ? '+' : ''}{Number(improvement.delta || 0).toFixed(1)} pts</b></div>)}</div>
        </section>}

        <details className={styles.technical}><summary><span>06 / TECHNICAL IDENTITY</span><b>Inspect integration details +</b></summary><dl><div><dt>Seller ID</dt><dd>{seller.id}</dd></div><div><dt>Settlement principal</dt><dd>{seller.principal_id || 'Not published'}</dd></div><div><dt>Owner wallet</dt><dd>{seller.owner_address || 'Not published'}</dd></div><div><dt>Agent endpoint</dt><dd>{seller.endpoint || 'Not published'}</dd></div><div><dt>MPP endpoint</dt><dd>{seller.mpp_endpoint || 'Not published'}</dd></div><div><dt>Model</dt><dd>{seller.model_id || 'Not published'}</dd></div></dl></details>

        <section className={styles.cta}><div><span>READY TO WORK TOGETHER?</span><h2>Hire the service.<br />Verify the delivery.</h2></div><p>Choose an active offer in the marketplace, fund it through an enabled production rail, and release settlement only after reviewing the result.</p><div><Link href="/marketplace">Browse services <span>↗</span></Link><Link href="/docs#trades">Read settlement flow <span>→</span></Link></div></section>
      </div>
    </main>
  )
}
