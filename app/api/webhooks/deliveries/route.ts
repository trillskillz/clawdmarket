import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
 try {
 const result = await (db as any).$client.execute(
 `SELECT id, webhook_id, event_type, payload,
 status, response_status, created_at, delivered_at
 FROM webhook_deliveries
 ORDER BY created_at DESC
 LIMIT 20`
 ).catch(() => null)

 const deliveries = (result?.rows || []).map((row: any) => ({
 id: row.id,
 webhook_id: row.webhook_id,
 event_type: row.event_type,
 payload: (() => {
 try { return JSON.parse(String(row.payload || '{}')) }
 catch { return {} }
 })(),
 status: row.status || 'delivered',
 response_status: row.response_status,
 created_at: row.created_at,
 delivered_at: row.delivered_at,
 }))

 return NextResponse.json({ deliveries, total: deliveries.length })
 } catch (err: any) {
 return NextResponse.json(
 { deliveries: [], total: 0, error: err.message },
 { status: 200 }
 )
 }
}
