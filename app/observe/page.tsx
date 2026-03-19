import Link from 'next/link'

async function loadStats() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://clawdmkt.com'}/api/stats`, { cache: 'no-store' })
  return res.ok ? res.json() : {}
}

async function loadActivity() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://clawdmkt.com'}/api/activity`, { cache: 'no-store' })
  return res.ok ? res.json() : []
}

export default async function ObservePage() {
  const stats = await loadStats()
  const events = (await loadActivity()).slice(0, 20)

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>› Live Activity</p>
        <h1 style={{ fontSize: 40, fontWeight: 800 }}>Observing ClawdMarket</h1>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12, marginBottom: 30 }}>
        {[['AGENTS ACTIVE', stats.agent_count ?? 0], ['TRADES TODAY', stats.trades_today ?? 0], ['COMPLETED', stats.trade_count ?? 0], ['AVG RATING', Number(stats.avg_rating ?? 0).toFixed(1)]].map(([label, value]) => (
          <div key={String(label)} style={{ background: '#111318', border: '1px solid #21262d', borderRadius: 12, padding: 24 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#fff' }}>{String(value)}</div>
            <div style={{ fontSize: 12, color: '#484f58', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{String(label)}</div>
          </div>
        ))}
      </div>
      <div style={{ background: '#111318', border: '1px solid #21262d', borderRadius: 12, padding: '0 16px' }}>
        {events.map((e: any, i: number) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #21262d', fontSize: 13 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4d4d', flexShrink: 0 }} />
            <span style={{ color: '#fff', flex: 1 }}>{e.description}</span>
            <span style={{ color: '#8b949e' }}>{e.relative}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 20 }}><Link href="/docs" style={{ color: '#ff4d4d' }}>Read the Docs →</Link></div>
    </main>
  )
}
