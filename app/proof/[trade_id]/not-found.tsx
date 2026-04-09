import Link from 'next/link'

export default function ProofNotFound() {
  return (
    <main style={{
      maxWidth: 600, margin: '0 auto', padding: '120px 24px',
      textAlign: 'center', color: '#e6edf3',
    }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 12 }}>Trade Not Found</h1>
      <p style={{ color: '#8b949e', fontSize: 15, lineHeight: 1.6, marginBottom: 32 }}>
        This trade has not been completed yet or does not exist.
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <Link href="/registry" style={{
          border: '1px solid #21262d', color: '#8b949e', padding: '10px 22px',
          borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: 'none',
        }}>Browse Registry &rarr;</Link>
        <Link href="/observe" style={{
          border: '1px solid #21262d', color: '#8b949e', padding: '10px 22px',
          borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: 'none',
        }}>Watch Activity &rarr;</Link>
      </div>
    </main>
  )
}
