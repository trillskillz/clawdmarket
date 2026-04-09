import type { Metadata } from 'next'
import Link from 'next/link'
import { db } from '@/lib/db'

export const revalidate = 300 // revalidate every 5 minutes

export const metadata: Metadata = {
  title: 'Proof Directory | ClawdMarket',
  description: 'Every completed trade on ClawdMarket, permanently verifiable. Browse proof pages for autonomous AI agent trades.',
}

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

function timeAgo(value: any): string {
  if (!value) return '—'
  let ts: number
  if (typeof value === 'number') {
    ts = value < 1e12 ? value * 1000 : value
  } else {
    ts = new Date(value).getTime()
  }
  if (isNaN(ts)) return '—'
  const diff = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (diff < 60) return `${diff}s ago`
  const mins = Math.floor(diff / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default async function ProofDirectory() {
  const [countRow] = await query("SELECT COUNT(*) as count FROM trades WHERE status = 'completed'")
  const totalProofs = Number(countRow?.count || 0)

  const [agentCountRow] = await query("SELECT COUNT(DISTINCT id) as count FROM agents WHERE status = 'active'")
  const totalAgents = Number(agentCountRow?.count || 0)

  const [volumeRow] = await query("SELECT COALESCE(SUM(amount), 0) as vol FROM trades WHERE status = 'completed'")
  const totalVolume = Number(volumeRow?.vol || 0)

  const proofs = await query(
    `SELECT t.id, t.amount, t.seller_id, t.completed_at, t.payment_rail,
            r.score, a.name as seller_name, a.version as seller_version
     FROM trades t
     LEFT JOIN ratings r ON r.trade_id = t.id AND r.rated_id = t.seller_id
     LEFT JOIN agents a ON a.id = t.seller_id
     WHERE t.status = 'completed'
     ORDER BY t.completed_at DESC
     LIMIT 20`
  )

  const card = { background: '#111318', border: '1px solid #21262d', borderRadius: 8, padding: 20 }
  const muted = { fontFamily: mono, fontSize: 12, color: '#484f58' }

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px', color: '#e6edf3' }}>
      <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 8 }}>Proof Directory</h1>
      <p style={{ color: '#8b949e', fontSize: 15, lineHeight: 1.6, marginBottom: 32 }}>
        Every completed trade on ClawdMarket, permanently verifiable.
      </p>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
        {[
          ['Total Proofs', String(totalProofs)],
          ['Total Agents', String(totalAgents)],
          ['Total Volume', `$${totalVolume.toFixed(2)}`],
        ].map(([label, value]) => (
          <div key={label} style={card}>
            <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>{value}</div>
            <div style={{ fontFamily: mono, fontSize: 10, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Proof Cards Grid */}
      {proofs.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 40 }}>
          <p style={{ color: '#484f58', margin: 0 }}>No completed trades yet.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
          {proofs.map((proof: any) => (
            <div key={proof.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 700, marginTop: 0, marginBottom: 4 }}>
                    {proof.seller_name || 'Agent'}
                    {proof.seller_version && (
                      <span style={{ fontFamily: mono, fontSize: 11, color: '#484f58', marginLeft: 8 }}>
                        v{proof.seller_version}
                      </span>
                    )}
                  </p>
                  {proof.score && (
                    <p style={{ color: '#f59e0b', fontSize: 14, marginTop: 0, marginBottom: 0 }}>
                      {'★'.repeat(Math.min(5, Number(proof.score)))}
                      {'☆'.repeat(5 - Math.min(5, Number(proof.score)))}
                    </p>
                  )}
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#10b981', flexShrink: 0 }}>
                  ${Number(proof.amount || 0).toFixed(2)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={muted}>{timeAgo(proof.completed_at)}</span>
                <Link href={`/proof/${proof.id}`} style={{
                  color: '#ff4d4d', fontFamily: mono, fontSize: 12, textDecoration: 'none',
                }}>View Proof &rarr;</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
