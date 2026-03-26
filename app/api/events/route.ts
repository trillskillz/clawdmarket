import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
 const encoder = new TextEncoder()

 const stream = new ReadableStream({
  async start(controller) {
   const send = (data: object) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
   }

   const stats = await (db as any).$client.execute(
    `SELECT
      (SELECT COUNT(*) FROM agents WHERE status='active') as agent_count,
      (SELECT COUNT(*) FROM trades) as total_trades,
      (SELECT COUNT(*) FROM trades WHERE status='completed') as completed_trades,
      (SELECT COUNT(*) FROM trades WHERE date(created_at) = date('now')) as trades_today`
   ).catch(() => null)

   send({ type: 'stats', data: stats?.rows?.[0] || {} })

   let lastId = ''
   const interval = setInterval(async () => {
    try {
     const trades = await (db as any).$client.execute(
      `SELECT t.id, t.buyer_id, t.seller_id, t.status,
      t.amount, t.created_at,
      a1.name as buyer_name,
      a2.name as seller_name
      FROM trades t
      LEFT JOIN agents a1 ON a1.id = t.buyer_id
      LEFT JOIN agents a2 ON a2.id = t.seller_id
      ORDER BY t.created_at DESC LIMIT 1`
     ).catch(() => null)

     const latest = trades?.rows?.[0]
     if (latest && String(latest.id) !== lastId) {
      lastId = String(latest.id)
      send({ type: 'trade', data: latest })

      const newStats = await (db as any).$client.execute(
       `SELECT
        (SELECT COUNT(*) FROM agents WHERE status='active') as agent_count,
        (SELECT COUNT(*) FROM trades) as total_trades,
        (SELECT COUNT(*) FROM trades WHERE status='completed') as completed_trades,
        (SELECT COUNT(*) FROM trades WHERE date(created_at) = date('now')) as trades_today`
      ).catch(() => null)
      send({ type: 'stats', data: newStats?.rows?.[0] || {} })
     }

     const agents = await (db as any).$client.execute(
      `SELECT id, name, capabilities, created_at
      FROM agents
      ORDER BY created_at DESC LIMIT 1`
     ).catch(() => null)

     const latestAgent = agents?.rows?.[0]
     if (latestAgent) {
      send({ type: 'agent', data: latestAgent })
     }

     send({ type: 'ping', ts: Date.now() })
    } catch {}
   }, 3000)

   request.signal.addEventListener('abort', () => {
    clearInterval(interval)
    controller.close()
   })
  },
 })

 return new Response(stream, {
  headers: {
   'Content-Type': 'text/event-stream',
   'Cache-Control': 'no-cache',
   Connection: 'keep-alive',
   'X-Accel-Buffering': 'no',
  },
 })
}
