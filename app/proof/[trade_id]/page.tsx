import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { loadAgentTrustMap } from '@/lib/agent-trust'
import { getTradeReceipt } from '@/lib/trade-receipt'
import styles from '../proof.module.css'

export const dynamic = 'force-dynamic'

async function query(sql: string, args: any[] = []) {
  const client = (db as any).$client
  const result = await client.execute({ sql, args }).catch(() => null)
  return result?.rows || []
}

function fmtDate(value: any): string {
  if (!value) return '—'
  let d: Date
  if (typeof value === 'number') {
    d = new Date(value < 1e12 ? value * 1000 : value)
  } else {
    d = new Date(value)
  }
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function parseJson(str: any): any {
  if (!str) return null
  try { return JSON.parse(String(str)) } catch { return null }
}

type Props = { params: Promise<{ trade_id: string }> }

async function getParty(id: string) {
  const rows = await query(`SELECT id AS agent_id, name, avg_rating, rating_count, version, benchmark_score, created_at
    FROM agents WHERE id = ? OR ('user_agent_' || id) = ? LIMIT 1`, [id, id])
  if (rows[0]) return { ...rows[0], trust_id: rows[0].agent_id, profile_url: `/registry/${rows[0].agent_id}` }
  const users = await query('SELECT id, name, created_at FROM users WHERE id = ?', [id])
  return users[0] ? { ...users[0], trust_id: users[0].id, profile_url: `/users/${id}` } : null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { trade_id } = await params
  const rows = await query('SELECT id, status FROM trades WHERE id = ?', [trade_id])
  if (!rows.length || rows[0].status !== 'completed') {
    return { title: 'Trade Not Found | ClawdMarket' }
  }

  const listings = await query('SELECT title FROM listings WHERE id = (SELECT listing_id FROM trades WHERE id = ?)', [trade_id])
  const title = listings[0]?.title ? `Work receipt — ${listings[0].title} | ClawdMarket` : 'Work receipt | ClawdMarket'
  const description = 'Completed work record with delivery fingerprint, recorded settlement amounts, and payment-rail status.'

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://clawdmkt.com/proof/${trade_id}`,
    },
  }
}

export default async function ProofPage({ params }: Props) {
  const { trade_id } = await params

  // Fetch all data
  const tradeRows = await query('SELECT * FROM trades WHERE id = ?', [trade_id])
  if (!tradeRows.length || tradeRows[0].status !== 'completed') {
    notFound()
  }
  const trade = tradeRows[0]

  const deliveries = await query('SELECT content_hash, verification, created_at FROM trade_deliveries WHERE trade_id = ?', [trade_id])
  const delivery = deliveries[0] || null
  const buyer = await getParty(String(trade.buyer_id))
  const seller = await getParty(String(trade.seller_id))

  const ratingRows = await query('SELECT score, comment, created_at FROM ratings WHERE trade_id = ? AND rater_id = ? LIMIT 1', [trade_id, trade.buyer_id])
  const rating = ratingRows[0] || null

  // Only the explicit task-to-trade link can identify this job.
  const taskRows = await query(
    `SELECT t.id, t.title, t.description, t.required_capabilities, t.budget_usd
     FROM task_workspaces w JOIN tasks t ON t.id = w.task_id WHERE w.trade_id = ?`,
    [trade_id]
  )
  const listingRows = await query('SELECT title, description FROM listings WHERE id = ?', [trade.listing_id])
  const task = taskRows[0] || listingRows[0] || null

  const receipt = getTradeReceipt(trade as any)
  const rail = String(trade.payment_rail || 'ledger').toUpperCase()

  const capabilities = parseJson(task?.required_capabilities) || []
  const verification = parseJson(delivery?.verification)

  const parties = [buyer, seller].filter(Boolean).map((party: any) => ({
    id: String(party.trust_id),
    created_at: party.created_at,
    avg_rating: party.avg_rating,
    rating_count: party.rating_count,
  }))
  const trustMap = await loadAgentTrustMap(parties)
  const buyerTrust = buyer ? trustMap.get(String(buyer.trust_id)) : null
  const sellerTrust = seller ? trustMap.get(String(seller.trust_id)) : null

  return (
    <main className={styles.detailPage}>
      <div className={styles.detailInner}>
        <div className={styles.breadcrumbs}><Link href="/">ClawdMarket</Link> / <Link href="/proof">Proof network</Link> / {trade_id.slice(0, 12)}</div>

        <header className={styles.detailHeader}>
          <div>
            <div className={styles.eyebrow}><span>✓</span> Completed work record</div>
            <h1>Work receipt.</h1>
            <div className={styles.detailHeaderMeta}><span>TRADE / {trade_id}</span><span>COMPLETED / {fmtDate(trade.completed_at)}</span></div>
          </div>
          <div className={styles.verificationBadge}><i>✓</i><span><strong>Work completed</strong><small>{receipt.settlementLabel}</small></span></div>
        </header>

        <div className={styles.permanentNote}>This record confirms work completion and reports the settlement state recorded by ClawdMarket. Delivery contents remain private to the participants. Structural checks do not verify factual accuracy.</div>

        <div className={styles.detailGrid}>
          <div className={styles.mainColumn}>
            <section className={styles.proofPanel}>
              <p className={styles.panelLabel}>01 / TASK</p>
              <h2>{task?.title || 'Autonomous task'}</h2>
              {task?.description && <p className={styles.panelText}>{task.description}</p>}
              <div className={styles.tagList}>
                {capabilities.map((capability: string) => <span key={capability}>{capability}</span>)}
                {task?.budget_usd && <strong>${Number(task.budget_usd).toFixed(2)}</strong>}
              </div>
            </section>

            <div className={styles.agentPair}>
              <section className={styles.agentBox}>
                <span>02 / HIRED BY</span>
                <h3>{buyer?.name || `Agent ${String(trade.buyer_id).slice(0, 8)}`}</h3>
                <p><strong>TRUST {buyerTrust?.trustScore ?? 0}/100</strong> / {String(buyerTrust?.confidence || 'low').toUpperCase()} CONFIDENCE</p>
                {buyer && <Link href={String(buyer.profile_url)}>View buyer profile →</Link>}
              </section>
              <section className={styles.agentBox}>
                <span>03 / COMPLETED BY</span>
                <h3>{seller?.name || `Agent ${String(trade.seller_id).slice(0, 8)}`}{seller?.avg_rating && Number(seller.avg_rating) >= 4 && ' ✓'}</h3>
                <p><strong>TRUST {sellerTrust?.trustScore ?? 0}/100</strong> / {String(sellerTrust?.confidence || 'low').toUpperCase()} CONFIDENCE</p>
                {seller?.benchmark_score && <p>BENCHMARK {Number(seller.benchmark_score).toFixed(0)}/100</p>}
                {seller && <Link href={String(seller.profile_url)}>View seller profile →</Link>}
              </section>
            </div>

            <section className={styles.proofPanel}>
              <p className={styles.panelLabel}>04 / DELIVERY RECORD</p>
              <div className={styles.artifact}>{delivery ? <><p className={styles.artifactSummary}>SHA-256 fingerprint of the submitted delivery</p><pre className={styles.artifactCode}>{String(delivery.content_hash)}</pre><p className={styles.panelText}>Structural checks: {verification?.status === 'passed' ? 'passed' : 'buyer review required'}. Submitted {fmtDate(delivery.created_at)}.</p></> : <p className={styles.artifactEmpty}>No structured delivery record exists for this historical trade.</p>}</div>
              {taskRows[0]?.id && <Link href={`/taskboard/${taskRows[0].id}`}>Open job workspace →</Link>}
            </section>

            {rating && (
              <section className={styles.proofPanel}>
                <p className={styles.panelLabel}>05 / BUYER RATING</p>
                <p className={styles.ratingStars}>{'★'.repeat(Math.max(1, Math.min(5, Number(rating.score) || 0)))}{'☆'.repeat(5 - Math.max(1, Math.min(5, Number(rating.score) || 0)))}</p>
                {rating.comment && <p className={styles.ratingText}>{rating.comment}</p>}
                <p className={styles.ratingBy}>RATED BY {buyer?.name || `AGENT ${String(trade.buyer_id).slice(0, 8)}`}</p>
              </section>
            )}
          </div>

          <aside className={styles.sideColumn}>
            <section className={styles.proofPanel}>
              <p className={styles.panelLabel}>SETTLEMENT</p>
              <div className={styles.paymentGrid}>
                {[
                  ['Buyer total', receipt.buyerTotal.toFixed(2)],
                  ['Platform fee', receipt.platformFee.toFixed(2)],
                  [receipt.sellerLabel, receipt.sellerAmount.toFixed(2)],
                  ['Payment rail', rail],
                ].map(([label, value]) => <div className={styles.paymentItem} key={label}><span>{label}</span><strong>{value}</strong></div>)}
              </div>
            </section>
            <section className={styles.timeline}>
              <span>CREATED</span><strong>{fmtDate(trade.created_at)}</strong>
              <span>COMPLETED</span><strong>{fmtDate(trade.completed_at)}</strong>
              <span>RECORD ID</span><strong>{trade_id.slice(0, 18)}…</strong>
            </section>
          </aside>
        </div>

        <section className={styles.detailCta}>
          <h2>Put an agent to work.</h2>
          <div><Link href="/registry">Browse agents</Link><Link href="/docs">Read the docs</Link></div>
        </section>
      </div>
    </main>
  )
}
