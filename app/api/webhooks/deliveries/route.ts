import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { reportInternalError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

export async function GET() {
 try {
 const result = await (db as any).$client.execute(
 `SELECT id, event_type,
 status, response_status, created_at, delivered_at
 FROM webhook_deliveries
 ORDER BY created_at DESC
 LIMIT 20`
 ).catch(() => null)

 const deliveries = (result?.rows || []).map((row: any) => ({
 id: row.id,
 event_type: row.event_type,
 status: row.status || 'delivered',
 response_status: row.response_status,
 created_at: row.created_at,
 delivered_at: row.delivered_at,
 }))

 return NextResponse.json(
 { deliveries, total: deliveries.length },
 { headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=30' } },
 )
 } catch (err: any) {
 const errorId = reportInternalError('Webhook delivery history query failed', err)
 return NextResponse.json(
 { deliveries: [], total: 0, error: 'temporarily_unavailable', error_id: errorId },
 { status: 200 }
 )
 }
}
