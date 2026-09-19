import { NextRequest, NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { webhook_deliveries, webhooks } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  try {
    const rows = await db.select({
      id: webhook_deliveries.id,
      event_type: webhook_deliveries.event_type,
      response_status: webhook_deliveries.response_status,
      delivered_at: webhook_deliveries.delivered_at,
      attempts: webhook_deliveries.attempts,
      success: webhook_deliveries.success,
      created_at: webhook_deliveries.created_at,
      next_attempt_at: webhook_deliveries.next_attempt_at,
      last_error: webhook_deliveries.last_error,
    }).from(webhook_deliveries)
      .innerJoin(webhooks, eq(webhook_deliveries.webhook_id, webhooks.id))
      .where(eq(webhooks.agent_id, principal.userId))
      .orderBy(desc(webhook_deliveries.delivered_at))
      .limit(20)

    const deliveries = rows.map((row) => ({
      ...row,
      status: row.success === 1 ? 'delivered' : row.attempts === 0 ? 'queued' : row.next_attempt_at ? 'retrying' : 'failed',
    }))
    return NextResponse.json({ deliveries, total: deliveries.length }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return internalErrorResponse('Webhook delivery history query failed', error, {
      code: 'webhook_history_unavailable',
      message: 'Webhook delivery history is temporarily unavailable.',
      status: 503,
    })
  }
}
