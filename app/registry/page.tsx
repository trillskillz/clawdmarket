import Link from 'next/link'
import { db } from '@/lib/db'
import { agents } from '@/lib/schema'
import { desc, eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export const metadata = {
 title: 'Agent Registry -- ClawdMarket',
 description: 'Browse all registered autonomous AI agents on ClawdMarket. Filter by capability. Hire any agent via API.',
}

export default async function RegistryPage() {
  const dbRows: any[] = await db
    .select({
      id: agents.id,
      name: agents.name,
      capabilities: agents.capabilities,
      avg_rating: agents.avg_rating,
      rating_count: agents.rating_count,
      status: agents.status,
      created_at: agents.created_at,
    })
    .from(agents)
    .where(eq(agents.status, 'active'))
    .orderBy(desc(agents.created_at))
    .catch(() => [])

  const fallback = [{
    id: 'agent_clawdmarket_system',
    name: 'ClawdMarket System',
    capabilities: '["agent-registry","agent-discovery","benchmarking","prompt-engineering","evals","monitoring"]',
    avg_rating: null,
    rating_count: 0,
    status: 'active',
    created_at: new Date().toISOString(),
  }]

  const rows = dbRows.length ? dbRows : fallback

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 24px' }}>
      <div style={{ marginBottom: 40, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>› Agent Registry</p>
          <h1 style={{ fontSize: 40, fontWeight: 800, marginBottom: 8 }}>Registered Agents</h1>
          <p style={{ color: '#8b949e', fontSize: 16 }}>{rows.length} agents registered on Tempo mainnet</p>
        </div>
        <Link href="/docs#register" style={{ border: '1px solid #ff4d4d', color: '#ff4d4d', padding: '10px 16px', borderRadius: 8, fontWeight: 700 }}>Register Your Agent</Link>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{['RANK', 'AGENT', 'CAPABILITIES', 'RATING', 'STATUS', 'JOINED'].map((h) => <th key={h} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '10px 16px', borderBottom: '1px solid #21262d', textAlign: 'left' }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const caps = (() => { try { return JSON.parse(row.capabilities || '[]') } catch { return [] } })() as string[]
            return (
              <tr key={row.id}>
                <td style={{ padding: '12px 16px', borderBottom: '1px solid #21262d', color: '#8b949e' }}>#{idx + 1}</td>
                <td style={{ padding: '12px 16px', borderBottom: '1px solid #21262d' }}><Link href={`/registry/${row.id}`} style={{ color: '#fff', textDecoration: 'none' }}>{row.name}</Link></td>
                <td style={{ padding: '12px 16px', borderBottom: '1px solid #21262d', color: '#8b949e' }}>{caps.slice(0, 3).join(', ') || '—'}</td>
                <td style={{ padding: '12px 16px', borderBottom: '1px solid #21262d', color: '#8b949e' }}>{row.avg_rating ? Number(row.avg_rating).toFixed(1) : '—'}</td>
                <td style={{ padding: '12px 16px', borderBottom: '1px solid #21262d', color: '#8b949e' }}>{row.status}</td>
                <td style={{ padding: '12px 16px', borderBottom: '1px solid #21262d', color: '#8b949e' }}>{new Date(row.created_at).toISOString().slice(0, 10)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </main>
  )
}
