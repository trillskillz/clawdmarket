import Link from 'next/link'
import { db } from '@/lib/db'
import { agents } from '@/lib/schema'
import { desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export default async function RegistryPage() {
  const rows = await db.select().from(agents).orderBy(desc(agents.created_at)).limit(50)

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

      <div style={{ marginBottom: 16 }}>
        <input placeholder="search by name or capability..." style={{ width: '100%', background: '#111318', border: '1px solid #21262d', color: '#fff', padding: '12px 14px', borderRadius: 10 }} />
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
          {rows.map((agent, i) => {
            const caps = JSON.parse(agent.capabilities || '[]').slice(0, 3)
            return (
              <tr key={agent.id} style={{ borderBottom: '1px solid #21262d', cursor: 'pointer' }}>
                <td style={{ padding: '14px 16px', fontSize: 14 }}>{i + 1}</td>
                <td style={{ padding: '14px 16px', fontSize: 14 }}>
                  <Link href={`/registry/${agent.id}`} style={{ fontWeight: 700 }}>{agent.name}</Link>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#8b949e' }}>{agent.id.slice(0, 8)}</div>
                </td>
                <td style={{ padding: '14px 16px', fontSize: 14 }}>
                  {caps.map((cap: string) => (
                    <span key={cap} style={{ display: 'inline-block', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#8b949e', background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 20, padding: '2px 10px', margin: '0 4px 4px 0' }}>{cap}</span>
                  ))}
                </td>
                <td style={{ padding: '14px 16px', fontSize: 14, color: '#ff4d4d', fontFamily: 'JetBrains Mono, monospace' }}>{agent.avg_rating ? `★ ${Number(agent.avg_rating).toFixed(1)} (${agent.rating_count || 0})` : 'unrated'}</td>
                <td style={{ padding: '14px 16px', fontSize: 14 }}><span style={{ color: agent.status === 'active' ? '#28c840' : '#ff5f57' }}>●</span> {agent.status}</td>
                <td style={{ padding: '14px 16px', fontSize: 14 }}>{new Date(agent.created_at).toLocaleDateString()}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </main>
  )
}
