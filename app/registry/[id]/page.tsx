import { notFound } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents, ratings } from '@/lib/schema'
import HireAgentCard from '@/components/HireAgentCard'

export const dynamic = 'force-dynamic'

const truncate = (v: string, left = 8, right = 6) => (v.length > left + right ? `${v.slice(0, left)}…${v.slice(-right)}` : v)

export default async function RegistryAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1).catch(() => [] as any[])
  if (!agent) notFound()

  const caps = JSON.parse(agent.capabilities || '[]') as string[]
  const recentReviews = await db.select({ id: ratings.id, score: ratings.score, comment: ratings.comment, created_at: ratings.created_at }).from(ratings).where(eq(ratings.rated_id, id)).orderBy(desc(ratings.created_at)).limit(5)
  const lineage = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://clawdmkt.com'}/api/agents/${id}/lineage`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 24px', display: 'grid', gridTemplateColumns: 'minmax(0,65%) minmax(0,35%)', gap: 24 }}>
      <section>
        <h1 style={{ fontSize: 42, fontWeight: 800, marginBottom: 12 }}>{agent.name}</h1>
        <div style={{ marginBottom: 12 }}>{caps.map((cap) => <span key={cap} style={{ display: 'inline-block', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#8b949e', background: '#0a0b0f', border: '1px solid #21262d', borderRadius: 20, padding: '2px 10px', margin: '0 4px 4px 0' }}>{cap}</span>)}</div>

        <div style={{ background: '#111318', border: '1px solid #21262d', borderRadius: 12, padding: 18, fontFamily: 'JetBrains Mono, monospace', fontSize: 13, lineHeight: 1.8, marginBottom: 20 }}>
          <div>ID {agent.id}</div>
          <div>ENDPOINT {agent.endpoint}</div>
          <div>OWNER {truncate(agent.owner_address || '')}</div>
          <div>REGISTERED {new Date(agent.created_at).toISOString()}</div>
          <div>MPP {agent.mpp_endpoint || 'not published'}</div>
        </div>

        <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>{agent.avg_rating ? `★★★★☆ ${Number(agent.avg_rating).toFixed(1)} (${agent.rating_count || 0} ratings)` : 'unrated'}</h3>

        <section style={{ background: '#111318', border: '1px solid #21262d', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <h4 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Lineage</h4>
          {lineage ? (
            <>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#8b949e', marginBottom: 8 }}>
                v{lineage.current_version || 1} · benchmark {lineage.current_benchmark_score ?? '—'} · velocity {lineage.velocity_score ?? '—'} · improvements {lineage.improvement_count || 0}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={{ textAlign: 'left', fontSize: 12, color: '#484f58' }}>version</th><th style={{ textAlign: 'left', fontSize: 12, color: '#484f58' }}>benchmark</th><th style={{ textAlign: 'left', fontSize: 12, color: '#484f58' }}>improved by</th><th style={{ textAlign: 'left', fontSize: 12, color: '#484f58' }}>date</th></tr></thead>
                  <tbody>
                    {(lineage.versions || []).slice(-8).map((v: any) => (
                      <tr key={v.id}><td style={{ padding: '6px 0', color: '#e8e8e8' }}>v{v.version}</td><td style={{ color: '#8b949e' }}>{v.benchmarkScore ?? '—'}</td><td style={{ color: '#8b949e' }}>{v.improvedByAgentId || '—'}</td><td style={{ color: '#8b949e' }}>{v.createdAt ? new Date(v.createdAt).toLocaleDateString() : '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p style={{ color: '#8b949e' }}>v1 — No improvements recorded yet</p>
          )}
        </section>
        <div style={{ display: 'grid', gap: 10 }}>
          {recentReviews.map((r) => (
            <article key={r.id} style={{ border: '1px solid #21262d', borderRadius: 10, padding: 12, background: '#111318' }}>
              <div style={{ color: '#ff4d4d', fontFamily: 'JetBrains Mono, monospace' }}>{'★'.repeat(r.score).padEnd(5, '☆')}</div>
              <p style={{ color: '#8b949e', marginTop: 6 }}>{r.comment || 'No written review'}</p>
            </article>
          ))}
        </div>
      </section>
      <aside>
        <HireAgentCard name={agent.name} rating={agent.avg_rating} ratingCount={agent.rating_count} />
      </aside>
    </main>
  )
}
