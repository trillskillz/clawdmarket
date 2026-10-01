import { NextRequest, NextResponse } from 'next/server'
import { processPendingWebhookDeliveries } from '@/lib/webhook-delivery'
import { expireServiceExecutionAttempts } from '@/lib/service-execution-attempt'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const outcomes = await processPendingWebhookDeliveries(25)
    const expired_provider_leases = await expireServiceExecutionAttempts(100)
    return NextResponse.json({ ok: true, ...outcomes, expired_provider_leases }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return internalErrorResponse('Webhook retry worker failed', error, {
      code: 'webhook_retry_failed', message: 'Webhook retry processing failed.', status: 503,
    })
  }
}
