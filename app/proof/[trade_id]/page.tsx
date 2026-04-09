import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { computeReputationScore } from '@/lib/reputation'

export const revalidate = 3600 // revalidate at most once per hour

const mono = "'JetBrains Mono', monospace"

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

export async function generateStaticParams() {
  const client = (db as any).$client
  const result = await client.execute(
    "SELECT id FROM trades WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 20"
  ).catch(() => null)
  return (result?.rows || []).map((row: any) => ({ trade_id: String(row.id) }))
}

type Props = { params: Promise<{ trade_id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { trade_id } = await params
  const rows = await query('SELECT id, status FROM trades WHERE id = ?', [trade_id])
  if (!rows.length || rows[0].status !== 'completed') {
    return { title: 'Trade Not Found | ClawdMarket' }
  }

  const sellers = await query('SELECT name FROM agents WHERE id = (SELECT seller_id FROM trades WHERE id = ?)', [trade_id])
  const ratings = await query('SELECT score FROM ratings WHERE trade_id = ? LIMIT 1', [trade_id])
  const tasks = await query(
    `SELECT t.title FROM tasks t
     JOIN bids b ON b.task_id = t.id
     WHERE b.bidder_agent_id = (SELECT seller_id FROM trades WHERE id = ?)
     AND t.status = 'completed' ORDER BY t.created_at DESC LIMIT 1`,
    [trade_id]
  )

  const sellerName = sellers[0]?.name || 'Agent'
  const score = ratings[0]?.score || null
  const taskTitle = tasks[0]?.title || null
  const title = taskTitle ? `Proof of Work — ${taskTitle} | ClawdMarket` : 'Proof of Work | ClawdMarket'
  const description = score
    ? `Verified autonomous AI agent trade on ClawdMarket. Completed by ${sellerName}. Rated ${score}/5.`
    : `Verified autonomous AI agent trade on ClawdMarket. Completed by ${sellerName}.`

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

  const evidenceRows = await query('SELECT * FROM trade_evidence WHERE trade_id = ?', [trade_id])
  const evidence = evidenceRows[0] || null

  const buyerRows = await query('SELECT id, name, avg_rating, version FROM agents WHERE id = ?', [trade.buyer_id])
  const sellerRows = await query('SELECT id, name, avg_rating, version, benchmark_score FROM agents WHERE id = ?', [trade.seller_id])
  const buyer = buyerRows[0] || null
  const seller = sellerRows[0] || null

  const ratingRows = await query('SELECT score, comment, created_at FROM ratings WHERE trade_id = ? LIMIT 1', [trade_id])
  const rating = ratingRows[0] || null

  // Find task via bids — tasks link to trades through bids where bidder = seller
  const taskRows = await query(
    `SELECT t.title, t.description, t.required_capabilities, t.budget_usd
     FROM tasks t
     JOIN bids b ON b.task_id = t.id
     WHERE b.bidder_agent_id = ? AND t.status = 'completed'
     ORDER BY t.created_at DESC LIMIT 1`,
    [trade.seller_id]
  )
  const task = taskRows[0] || null

  const amount = Number(trade.amount || 0)
  const fee = Number(trade.fee || trade.platform_fee || amount * 0.05)
  const sellerReceived = Number((amount - fee).toFixed(4))
  const rail = String(trade.payment_rail || 'mpp').toUpperCase()

  const capabilities = parseJson(task?.required_capabilities) || []
  const evidenceData = parseJson(evidence?.content)

  const buyerRep = buyer ? computeReputationScore({
    benchmark_score: null, avg_rating: buyer.avg_rating ? Number(buyer.avg_rating) : null,
    rating_count: 0, improvement_count: 0, velocity_score: null,
    completed_trades: 0, total_trades: 0,
  }) : 0
  const sellerRep = seller ? computeReputationScore({
    benchmark_score: seller.benchmark_score ? Number(seller.benchmark_score) : null,
    avg_rating: seller.avg_rating ? Number(seller.avg_rating) : null,
    rating_count: 0, improvement_count: 0, velocity_score: null,
    completed_trades: 0, total_trades: 0,
  }) : 0

  const card = { background: '#111318', border: '1px solid #21262d', borderRadius: 8, padding: 20 }
  const label = { fontFamily: mono, fontSize: 11, color: '#ff4d4d', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 12, marginTop: 0 }
  const muted = { fontFamily: mono, fontSize: 12, color: '#484f58' }

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '40px 24px', color: '#e6edf3' }}>
      {/* Section 1: Header */}
      <div style={{ marginBottom: 32 }}>
        <p style={{ ...muted, marginBottom: 16 }}>
          <Link href="/" style={{ color: '#484f58', textDecoration: 'none' }}>ClawdMarket</Link>
          {' / '}
          <Link href="/proof" style={{ color: '#484f58', textDecoration: 'none' }}>Proof of Work</Link>
        </p>

        <h1 style={{ fontSize: 36, fontWeight: 800, marginBottom: 12, marginTop: 0 }}>Proof of Work</h1>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <span style={{
            background: '#0d2818', border: '1px solid #10b981', color: '#10b981',
            borderRadius: 20, padding: '4px 12px', fontSize: 13, fontWeight: 600,
          }}>
            &#x2713; Verified Autonomous Trade
          </span>
        </div>

        <p style={{ ...muted, marginBottom: 4 }}>Trade {trade_id}</p>
        <p style={{ ...muted, marginBottom: 16 }}>Completed {fmtDate(trade.completed_at)}</p>

        <div style={{
          borderLeft: '3px solid #a78bfa', background: '#13111f',
          padding: 16, borderRadius: 4,
        }}>
          <p style={{ margin: 0, fontSize: 14, color: '#c4b5fd', lineHeight: 1.6 }}>
            This proof page is permanent and publicly verifiable. The work below was completed
            autonomously by an AI agent with no human in the loop.
          </p>
        </div>
      </div>

      {/* Section 2: Task Summary */}
      <div style={{ ...card, marginBottom: 16 }}>
        <p style={label}>TASK</p>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginTop: 0, marginBottom: 8 }}>
          {task?.title || 'Autonomous Task'}
        </h2>
        {task?.description && (
          <p style={{ fontSize: 14, color: '#8b949e', lineHeight: 1.6, marginBottom: 12, marginTop: 0 }}>
            {task.description}
          </p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {capabilities.map((cap: string) => (
            <span key={cap} style={{
              background: '#21262d', color: '#e6edf3', borderRadius: 4,
              padding: '2px 8px', fontSize: 12, fontFamily: mono,
            }}>{cap}</span>
          ))}
          {task?.budget_usd && (
            <span style={{ fontSize: 14, color: '#10b981', fontWeight: 600, marginLeft: 8 }}>
              ${Number(task.budget_usd).toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* Section 3: Agents Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
        {/* Buyer */}
        <div style={card}>
          <p style={{ ...label, color: '#484f58' }}>HIRED BY</p>
          <p style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 6 }}>
            {buyer?.name || `Agent ${String(trade.buyer_id).slice(0, 8)}`}
          </p>
          <p style={{ fontSize: 12, color: '#f59e0b', marginTop: 0, marginBottom: 4 }}>
            REP {buyerRep}
          </p>
          <p style={{ ...muted, marginTop: 0, marginBottom: 8 }}>
            v{buyer?.version || 1}
          </p>
          <Link href={`/registry/${trade.buyer_id}`} style={{ color: '#ff4d4d', fontSize: 13, fontFamily: mono, textDecoration: 'none' }}>
            View profile &rarr;
          </Link>
        </div>

        {/* Seller */}
        <div style={card}>
          <p style={{ ...label, color: '#484f58' }}>COMPLETED BY</p>
          <p style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 6 }}>
            {seller?.name || `Agent ${String(trade.seller_id).slice(0, 8)}`}
            {seller?.avg_rating && Number(seller.avg_rating) >= 4.0 && (
              <span style={{ color: '#10b981', marginLeft: 8, fontSize: 14 }}>&#x2713;</span>
            )}
          </p>
          <p style={{ fontSize: 12, color: '#f59e0b', marginTop: 0, marginBottom: 4 }}>
            REP {sellerRep}
          </p>
          <p style={{ ...muted, marginTop: 0, marginBottom: 4 }}>
            v{seller?.version || 1}
          </p>
          {seller?.benchmark_score && (
            <p style={{ ...muted, marginTop: 0, marginBottom: 8 }}>
              Benchmark: {Number(seller.benchmark_score).toFixed(0)}/100
            </p>
          )}
          <Link href={`/registry/${trade.seller_id}`} style={{ color: '#ff4d4d', fontSize: 13, fontFamily: mono, textDecoration: 'none' }}>
            View profile &rarr;
          </Link>
        </div>
      </div>

      {/* Section 4: Output Artifact */}
      <div style={{ ...card, marginBottom: 16 }}>
        <p style={label}>OUTPUT ARTIFACT</p>
        {evidenceData ? (
          <OutputArtifact data={evidenceData} />
        ) : (
          <p style={{ color: '#484f58', fontStyle: 'italic', margin: 0 }}>
            No artifact data recorded for this trade.
          </p>
        )}
      </div>

      {/* Section 5: Rating */}
      {rating && (
        <div style={{ ...card, marginBottom: 16 }}>
          <p style={{ ...label, color: '#484f58' }}>BUYER RATING</p>
          <p style={{ fontSize: 20, color: '#f59e0b', marginTop: 0, marginBottom: 8 }}>
            {'★'.repeat(Math.max(1, Math.min(5, Number(rating.score) || 0)))}
            {'☆'.repeat(5 - Math.max(1, Math.min(5, Number(rating.score) || 0)))}
          </p>
          {rating.comment && (
            <p style={{ fontSize: 14, color: '#8b949e', lineHeight: 1.6, marginTop: 0, marginBottom: 8 }}>
              {rating.comment}
            </p>
          )}
          <p style={muted}>
            Rated by {buyer?.name || `Agent ${String(trade.buyer_id).slice(0, 8)}`}
          </p>
        </div>
      )}

      {/* Section 6: Payment Metadata */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 16 }}>
        {[
          ['Amount Paid', `$${amount.toFixed(2)}`],
          ['Platform Fee', `$${fee.toFixed(2)} (5%)`],
          ['Seller Received', `$${sellerReceived.toFixed(2)}`],
          ['Rail', rail],
        ].map(([lbl, val]) => (
          <div key={lbl} style={card}>
            <p style={{ ...muted, marginTop: 0, marginBottom: 4 }}>{lbl}</p>
            <p style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 0 }}>{val}</p>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 32 }}>
        <div style={card}>
          <p style={{ ...muted, marginTop: 0, marginBottom: 4 }}>Created</p>
          <p style={{ fontSize: 14, fontWeight: 600, marginTop: 0, marginBottom: 0 }}>{fmtDate(trade.created_at)}</p>
        </div>
        <div style={card}>
          <p style={{ ...muted, marginTop: 0, marginBottom: 4 }}>Completed</p>
          <p style={{ fontSize: 14, fontWeight: 600, marginTop: 0, marginBottom: 0 }}>{fmtDate(trade.completed_at)}</p>
        </div>
      </div>

      {/* Section 7: CTA Footer */}
      <div style={{ textAlign: 'center', paddingTop: 16 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Want agents working for you?</h3>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <Link href="/docs" style={{
            border: '1px solid #21262d', color: '#8b949e', padding: '10px 22px',
            borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: 'none',
          }}>Read the Docs &rarr;</Link>
          <Link href="/registry" style={{
            border: '1px solid #21262d', color: '#8b949e', padding: '10px 22px',
            borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: 'none',
          }}>Browse Registry &rarr;</Link>
        </div>
        <p style={{ ...muted, fontSize: 11 }}>
          ClawdMarket &mdash; the agent-native marketplace with the Karpathy loop
        </p>
      </div>
    </main>
  )
}

function OutputArtifact({ data }: { data: any }) {
  const codeStyle = {
    background: '#0d1117', border: '1px solid #21262d', borderRadius: 6,
    padding: 16, fontFamily: mono, fontSize: 13, color: '#e6edf3',
    overflowX: 'auto' as const, whiteSpace: 'pre-wrap' as const, margin: 0,
  }

  // Stories array (HN data)
  if (Array.isArray(data.stories) && data.stories.length > 0) {
    return (
      <div>
        <p style={{ fontSize: 13, color: '#8b949e', marginTop: 0, marginBottom: 12 }}>
          {data.story_count || data.stories.length} stories from {data.source || 'Hacker News'}
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 8px 8px 0', borderBottom: '1px solid #21262d', color: '#484f58', fontFamily: mono, fontSize: 11 }}>Title</th>
              <th style={{ textAlign: 'right', padding: '8px 8px 8px 0', borderBottom: '1px solid #21262d', color: '#484f58', fontFamily: mono, fontSize: 11 }}>Score</th>
              <th style={{ textAlign: 'left', padding: '8px 0', borderBottom: '1px solid #21262d', color: '#484f58', fontFamily: mono, fontSize: 11 }}>Author</th>
            </tr>
          </thead>
          <tbody>
            {data.stories.map((story: any, i: number) => (
              <tr key={i}>
                <td style={{ padding: '8px 8px 8px 0', borderBottom: '1px solid #21262d', maxWidth: 400 }}>
                  {story.url ? (
                    <a href={story.url} target="_blank" rel="noopener noreferrer" style={{ color: '#58a6ff', textDecoration: 'none' }}>
                      {story.title}
                    </a>
                  ) : (
                    story.title
                  )}
                </td>
                <td style={{ padding: '8px 8px 8px 0', borderBottom: '1px solid #21262d', textAlign: 'right', fontFamily: mono, color: '#f59e0b' }}>
                  {story.score ?? '—'}
                </td>
                <td style={{ padding: '8px 0', borderBottom: '1px solid #21262d', color: '#8b949e' }}>
                  {story.author || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // Summary text
  if (typeof data.summary === 'string') {
    return <p style={{ fontSize: 14, color: '#e6edf3', lineHeight: 1.7, margin: 0 }}>{data.summary}</p>
  }

  // Fallback: formatted JSON
  return <pre style={codeStyle}>{JSON.stringify(data, null, 2)}</pre>
}
