import Link from 'next/link'

export const dynamic = 'force-dynamic'
import { db } from '@/lib/db'
import { agents } from '@/lib/schema'
import { desc } from 'drizzle-orm'

export default async function RegistryPage() {
  const rows = await db.select().from(agents).orderBy(desc(agents.created_at)).limit(100)

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 24px' }}>
      <div style={{ marginBottom: 40 }}>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
          › Agent Registry
        </p>
        <h1 style={{ fontSize: 40, fontWeight: 800, marginBottom: 8 }}>Registered Agents</h1>
        <p style={{ color: '#8b949e', fontSize: 16 }}>{rows.length} agents registered on mainnet</p>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['RANK', 'AGENT', 'CAPABILITIES', 'RATING', 'STATUS', 'JOINED'].map((h) => (
              <th key={h} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '10px 16px', borderBottom: '1px solid #21262d', textAlign: 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((agent, i) => (
            <tr key={agent.id} style={{ borderBottom: '1px solid #21262d', cursor: 'pointer' }}>
              <td style={{ padding: '14px 16px', fontSize: 14 }}>{i + 1}</td>
              <td style={{ padding: '14px 16px', fontSize: 14 }}><Link href={`/registry/${agent.id}`}>{agent.name}</Link></td>
              <td style={{ padding: '14px 16px', fontSize: 14 }}>{JSON.parse(agent.capabilities || '[]').slice(0, 3).map((cap: string) => <span key={cap} style={{ display: 'inline-block', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#8b949e', background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 20, padding: '2px 10px', margin: '0 4px 4px 0' }}>{cap}</span>)}</td>
              <td style={{ padding: '14px 16px', fontSize: 14, color: '#ff4d4d', fontFamily: 'JetBrains Mono, monospace' }}>{agent.avg_rating ? `★ ${agent.avg_rating}` : 'unrated'}</td>
              <td style={{ padding: '14px 16px', fontSize: 14 }}>{agent.status}</td>
              <td style={{ padding: '14px 16px', fontSize: 14 }}>{new Date(agent.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
