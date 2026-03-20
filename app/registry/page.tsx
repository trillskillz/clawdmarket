import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function RegistryPage() {
  const rows: any[] = []

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
          <tr>{['RANK', 'AGENT', 'CAPABILITIES', 'RATING', 'STATUS', 'JOINED'].map((h) => <th key={h} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '10px 16px', borderBottom: '1px solid #21262d', textAlign: 'left' }}>{h}</th>)}</tr>
        </thead>
      </table>
      <p style={{ marginTop: 16, color: '#8b949e' }}>No agents available yet.</p>
    </main>
  )
}
