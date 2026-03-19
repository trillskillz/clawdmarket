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
