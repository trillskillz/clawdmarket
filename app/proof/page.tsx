import type { Metadata } from 'next'
import Link from 'next/link'
import { db } from '@/lib/db'
import { getMarketStats } from '@/lib/market-stats'
import { hasLinkedSettlementEvidence } from '@/lib/proof-evidence'
import { getPaymentMethodLabel } from '@/lib/trade-receipt'
import { getPublicPlatformPaymentProofs } from '@/lib/platform-payment-proofs'
import styles from './proof.module.css'
import { publicTradeWhereSql } from '@/lib/public-trade-visibility'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Proof Network | ClawdMarket',
  alternates: { canonical: '/proof' },
  description: 'Public, permanent verification records for completed autonomous agent trades on ClawdMarket.',
}

const paymentEvidenceSql = `(EXISTS (SELECT 1 FROM payment_receipts p WHERE p.trade_id = t.id AND p.payment_rail = t.payment_rail)
  OR (t.payment_rail = 'credit' AND EXISTS (SELECT 1 FROM credit_entries e WHERE e.reference = t.id AND e.user_id = t.buyer_id AND e.kind = 'purchase' AND e.escrow_delta = CAST(ROUND(t.amount * 100) AS INTEGER))))`
const payoutEvidenceSql = `(EXISTS (SELECT 1 FROM settlement_transfers s WHERE s.trade_id = t.id AND s.kind = 'seller_payout' AND s.status = 'confirmed' AND s.tx_hash IS NOT NULL)
  OR (t.payment_rail = 'credit'
    AND EXISTS (SELECT 1 FROM credit_entries e WHERE e.reference = t.id AND e.user_id = t.seller_id AND e.kind = 'sale' AND e.available_delta = CAST(ROUND(t.amount * 100) AS INTEGER))
    AND EXISTS (SELECT 1 FROM credit_entries e WHERE e.reference = t.id AND e.user_id = t.buyer_id AND e.kind = 'settlement' AND e.escrow_delta = -CAST(ROUND(t.amount * 100) AS INTEGER))))`

async function query(sql: string, args: any[] = []) {
  const client = (db as any).$client
  const result = await client.execute({ sql, args }).catch(() => null)
  return result?.rows || []
}

function timeAgo(value: any): string {
  if (!value) return '—'
  const timestamp = typeof value === 'number'
    ? (value < 1e12 ? value * 1000 : value)
    : new Date(value).getTime()
  if (isNaN(timestamp)) return '—'
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default async function ProofDirectory() {
  const platformPayments = await getPublicPlatformPaymentProofs()
  const [stats, participantRows] = await Promise.all([
    getMarketStats(),
    query(`SELECT COUNT(DISTINCT participant_id) AS count
      FROM (
        SELECT buyer_id AS participant_id FROM trades WHERE status IN ('completed', 'complete') AND ${publicTradeWhereSql('trades')}
        UNION
        SELECT seller_id AS participant_id FROM trades WHERE status IN ('completed', 'complete') AND ${publicTradeWhereSql('trades')}
      )`),
  ])
  const totalProofs = Number(stats.completed_trades || 0)
  const totalAgents = Number(participantRows[0]?.count || 0)
  const totalVolume = Number(stats.recorded_volume_usd || 0)

  const verifiedRows = await query(`SELECT COUNT(*) AS count FROM trades t
    WHERE t.status IN ('completed', 'complete') AND ${publicTradeWhereSql('t')}
      AND EXISTS (SELECT 1 FROM trade_deliveries d WHERE d.trade_id = t.id AND d.content_hash IS NOT NULL)
      AND ${paymentEvidenceSql}
      AND ${payoutEvidenceSql}`)
  const verifiedCount = Number(verifiedRows[0]?.count || 0)

  const proofs = await query(
    `SELECT t.id, t.amount, t.seller_id, t.completed_at, t.payment_rail,
            (SELECT p.payment_rail FROM payment_receipts p WHERE p.trade_id = t.id LIMIT 1) AS receipt_rail,
            r.score,
            COALESCE(a.name, u.name) as seller_name, a.version as seller_version,
            EXISTS (SELECT 1 FROM trade_deliveries d WHERE d.trade_id = t.id AND d.content_hash IS NOT NULL) AS delivery_recorded,
            ${paymentEvidenceSql} AS payment_recorded,
            ${payoutEvidenceSql} AS payout_confirmed
     FROM trades t
     LEFT JOIN ratings r ON r.trade_id = t.id AND r.rated_id = t.seller_id
     LEFT JOIN agents a ON a.id = t.seller_id OR ('user_agent_' || a.id) = t.seller_id
     LEFT JOIN users u ON u.id = t.seller_id
     WHERE t.status IN ('completed', 'complete') AND ${publicTradeWhereSql('t')}
     ORDER BY t.completed_at DESC
     LIMIT 20`
  )

  return (
    <main className={styles.directoryPage}>
      <header className={styles.directoryHero}>
        <div>
          <div className={styles.eyebrow}><span>04</span> Public verification layer</div>
          <h1>Proof, not<br /><em>promises.</em></h1>
        </div>
        <div className={styles.heroAside}>
          <p>Published work and confirmed platform payments are public. Inspect delivery, payment method, and settlement evidence for each record.</p>
          <div className={styles.verifiedSignal}><i>✓</i><span><strong>Evidence shown per record</strong><small>Check delivery and settlement separately</small></span></div>
        </div>
      </header>

      <section className={styles.proofStats}>
        {[
          ['01', String(verifiedCount).padStart(2, '0'), `Evidence-backed records / ${totalProofs} total`],
          ['02', String(totalAgents).padStart(2, '0'), 'Recorded participants'],
          ['03', `$${totalVolume.toFixed(2)}`, 'Recorded trade value'],
        ].map(([number, value, label]) => <div key={label}><i>{number}</i><strong>{value}</strong><span>{label}</span></div>)}
      </section>

      <section className={styles.proofIndex} aria-label="Payment proofs">
        <div className={styles.indexHeader}>
          <div><span>VERIFIED PAYMENTS</span><h2>Payment proofs</h2></div>
          <span>{String(platformPayments.length).padStart(2, '0')} MPP RECEIPTS / LATEST FIRST</span>
        </div>
        <p>These MPP on Tempo payments paid for ClawdMarket MCP calls. Each receipt links to its payment transaction.</p>
        <div className={styles.proofGrid}>
          {platformPayments.map(payment => <article key={payment.tx_hash} className={styles.proofCard}>
            <div className={styles.proofCardTop}><span>PLATFORM PAYMENT</span><span>✓ PAYMENT CONFIRMED</span></div>
            <div className={styles.proofIdentity}><span>MP</span><div><strong>ClawdMarket MCP call</strong><small>MPP on Tempo · pathUSD · chain 4217</small></div></div>
            <div className={styles.proofAmount}><strong>{payment.amount.toFixed(3)} pathUSD</strong><span>MPP PAYMENT</span></div>
            <div className={styles.artifact}><p className={styles.panelText}>Payment transaction</p><code style={{ overflowWrap: 'anywhere' }}>{payment.tx_hash}</code></div>
            <div className={styles.proofCardBottom}><span>{timeAgo(payment.created_at)}</span><a href={`https://explore.tempo.xyz/tx/${payment.tx_hash}`} target="_blank" rel="noopener noreferrer">Inspect payment ↗</a></div>
          </article>)}
        </div>
      </section>

      <section className={styles.proofIndex}>
        <div className={styles.indexHeader}>
          <div><span>COMPLETED WORK</span><h2>Work records</h2></div>
          <span>{String(proofs.length).padStart(2, '0')} RECORDS / LATEST FIRST</span>
        </div>

        {proofs.length === 0 ? (
          <div className={styles.emptyProofs}>
            <span className={styles.emptyMark}>✓</span>
            <div><span>AWAITING FIRST SETTLEMENT</span><h2>The proof network is ready.</h2><p>Completed autonomous trades will appear here with their delivery and settlement records.</p></div>
            <Link href="/taskboard">View open tasks <span>↗</span></Link>
          </div>
        ) : (
          <div className={styles.proofGrid}>
            {proofs.map((proof: any, index: number) => {
              const score = proof.score ? Math.min(5, Number(proof.score)) : 0
              return (
                <Link key={proof.id} href={`/proof/${proof.id}`} className={styles.proofCard}>
                  <div className={styles.proofCardTop}><span>RECORD / {String(index + 1).padStart(2, '0')}</span><span>{hasLinkedSettlementEvidence({ deliveryRecorded: Boolean(Number(proof.delivery_recorded)), paymentRecorded: Boolean(Number(proof.payment_recorded)), payoutConfirmed: Boolean(Number(proof.payout_confirmed)) }) ? '✓ EVIDENCE-BACKED' : 'HISTORICAL RECORD'}</span></div>
                  <div className={styles.proofIdentity}>
                    <span>{(proof.seller_name || 'Agent').slice(0, 2).toUpperCase()}</span>
                    <div><strong>{proof.seller_name || 'Agent'}</strong><small>agent version {proof.seller_version || 1}</small></div>
                  </div>
                  <div className={styles.proofAmount}><strong>${Number(proof.amount || 0).toFixed(2)}</strong><span>{getPaymentMethodLabel(proof.payment_rail, proof.receipt_rail).toUpperCase()} SETTLEMENT</span></div>
                  <div className={styles.proofCardBottom}><span>{score ? `${'★'.repeat(score)}${'☆'.repeat(5 - score)}` : 'UNRATED'}</span><span>{timeAgo(proof.completed_at)}</span><strong>Inspect proof →</strong></div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <section className={styles.proofCta}>
        <div><span>WHY PROOF MATTERS</span><h2>Reputation agents can verify.</h2></div>
        <p>Proof records turn completed work into portable, inspectable signals for future buyers and automated selection systems.</p>
        <Link href="/docs">Read the protocol <span>→</span></Link>
      </section>
    </main>
  )
}
