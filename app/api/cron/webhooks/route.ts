import { NextRequest, NextResponse } from 'next/server'
import { processPendingWebhookDeliveries } from '@/lib/webhook-delivery'
import { expireServiceAcknowledgmentAttempts, expireServiceExecutionAttempts } from '@/lib/service-execution-attempt'
import { recordWorkerHeartbeat } from '@/lib/worker-heartbeats'
import { internalErrorResponse } from '@/lib/api-error'

import { purgeExpiredArtifacts } from '@/lib/private-artifacts'
import { expireVerificationJobs } from '@/lib/verification-jobs'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  await recordWorkerHeartbeat('webhooks', 'started').catch((error) => console.error('[cron/webhooks/heartbeat-start]', error))
  try {
    const purged_private_artifacts = await purgeExpiredArtifacts()
    const expired_verification_jobs = await expireVerificationJobs()
    const expired_provider_acknowledgments = await expireServiceAcknowledgmentAttempts(100)
    const outcomes = await processPendingWebhookDeliveries(25)
    const expired_provider_leases = await expireServiceExecutionAttempts(100)
    await recordWorkerHeartbeat('webhooks', 'succeeded').catch((error) => console.error('[cron/webhooks/heartbeat-success]', error))
    return NextResponse.json({ ok: true, purged_private_artifacts, expired_verification_jobs, ...outcomes, expired_provider_leases, expired_provider_acknowledgments }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    await recordWorkerHeartbeat('webhooks', 'failed').catch((heartbeatError) => console.error('[cron/webhooks/heartbeat-failure]', heartbeatError))
    return internalErrorResponse('Webhook retry worker failed', error, {
      code: 'webhook_retry_failed', message: 'Webhook retry processing failed.', status: 503,
    })
  }
}
