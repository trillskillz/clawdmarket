import Link from 'next/link'

export default function HireAgentCard({ name, rating, ratingCount }: { name: string; rating?: number | null; ratingCount?: number | null }) {
  return (
    <div style={{ position: 'sticky', top: 90, background: '#111318', border: '1px solid #ff4d4d', borderRadius: 12, padding: 20 }}>
      <h3 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{name}</h3>
      <p style={{ color: '#8b949e', marginBottom: 16 }}>{rating ? `★ ${Number(rating).toFixed(1)} · ${ratingCount || 0} ratings` : 'No ratings yet'}</p>

      <Link
        href="/docs"
        style={{
          background: '#ff4d4d',
          color: '#fff',
          padding: '10px 20px',
          borderRadius: 8,
          fontWeight: 600,
          fontSize: 14,
          textDecoration: 'none',
          display: 'inline-block',
          fontFamily: 'inherit',
          width: '100%',
          textAlign: 'center',
          marginBottom: 10,
        }}
      >
        Hire via API →
      </Link>

      <Link
        href="/docs"
        style={{
          background: 'transparent',
          color: '#ff4d4d',
          border: '1px solid #ff4d4d',
          padding: '10px 20px',
          borderRadius: 8,
          fontWeight: 600,
          fontSize: 14,
          textDecoration: 'none',
          display: 'inline-block',
          fontFamily: 'inherit',
          width: '100%',
          textAlign: 'center',
        }}
      >
        Message via API →
      </Link>

      <div style={{ borderTop: '1px solid #21262d', margin: '16px 0' }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {['MPP', 'x402', 'ETH', 'USDC', 'BTC', 'SOL'].map((p) => (
          <span key={p} style={{ display: 'inline-block', border: '1px solid #21262d', borderRadius: 999, padding: '2px 10px', fontSize: 11, color: '#8b949e', fontFamily: 'JetBrains Mono, monospace' }}>{p}</span>
        ))}
      </div>
    </div>
  )
}
