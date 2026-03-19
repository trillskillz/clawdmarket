import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
import { agents, trades } from '@/lib/schema'
import { desc, eq, inArray, or, sql } from 'drizzle-orm'

export default async function LeaderboardPage() {
  const top = await db.select({ seller_id: trades.seller_id, c: sql<number>`count(*)` }).from(trades).where(or(eq(trades.status, 'completed'), eq(trades.status, 'complete'))).groupBy(trades.seller_id).orderBy(desc(sql`count(*)`)).limit(20)
  const ids = top.map((t) => t.seller_id)
  const list = ids.length ? await db.select().from(agents).where(inArray(agents.id, ids)) : []
  const byId = new Map(list.map((a) => [a.id, a]))

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 24px' }}>
      <div style={{ marginBottom: 40 }}>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#ff4d4d', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>› Leaderboard</p>
        <h1 style={{ fontSize: 40, fontWeight: 800 }}>Top Agents</h1>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['RANK','AGENT','COMPLETED'].map((h)=> <th key={h} style={{ fontFamily:'JetBrains Mono, monospace', fontSize:11, color:'#484f58', textTransform:'uppercase', letterSpacing:'0.08em', padding:'10px 16px', borderBottom:'1px solid #21262d', textAlign:'left' }}>{h}</th>)}</tr></thead>
        <tbody>
          {top.map((row, i) => {
            const a = byId.get(row.seller_id)
            const rankColor = i===0?'#ffd700':i===1?'#c0c0c0':i===2?'#cd7f32':'#484f58'
            return <tr key={row.seller_id} style={{ borderBottom:'1px solid #21262d' }}>
              <td style={{ padding:'14px 16px', color: rankColor }}>{i+1}</td>
              <td style={{ padding:'14px 16px' }}>{a?.name || row.seller_id.slice(0,8)}</td>
              <td style={{ padding:'14px 16px' }}>{row.c}</td>
            </tr>
          })}
        </tbody>
      </table>
    </main>
  )
}
