import { NextRequest, NextResponse } from 'next/server'
import { recordAgentHeartbeat } from '@/lib/agent-heartbeat'
import { internalErrorResponse } from '@/lib/api-error'
import { lookupRegisteredAgentApiKey } from '@/lib/registered-agent-auth'
import { REFERENCE_FLEET_AGENTS } from '@/lib/reference-fleet-manifest'
import { parseReferenceFleetRuntimeKeys } from '@/lib/reference-fleet-runtime'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const entries = parseReferenceFleetRuntimeKeys(process.env.REFERENCE_FLEET_KEYS_JSON)
    if (entries.length === 0) {
      return NextResponse.json({
        error: 'reference_fleet_not_configured',
        message: 'REFERENCE_FLEET_KEYS_JSON has no managed presence credentials.',
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }

    const outcomes = []
    for (const entry of entries) {
      const auth = await lookupRegisteredAgentApiKey(entry.presenceKey, { requiredScope: 'agent:write' })
      if (auth.kind !== 'agent' || auth.agentId !== entry.agentId) {
        outcomes.push({ slug: entry.slug, agent_id: entry.agentId, ok: false, error: 'credential_rejected' })
        continue
      }
      const heartbeat = await recordAgentHeartbeat(entry.agentId)
      if (heartbeat.kind !== 'ok') {
        outcomes.push({ slug: entry.slug, agent_id: entry.agentId, ok: false, error: heartbeat.kind })
        continue
      }
      outcomes.push({
        slug: entry.slug,
        agent_id: entry.agentId,
        ok: true,
        pending_tasks: heartbeat.pendingTasks,
      })
    }

    const healthy = outcomes.filter((outcome) => outcome.ok).length
    const complete = entries.length === REFERENCE_FLEET_AGENTS.length
    const ok = complete && healthy === entries.length
    return NextResponse.json({
      ok,
      expected: REFERENCE_FLEET_AGENTS.length,
      configured: entries.length,
      healthy,
      failed: entries.length - healthy,
      outcomes,
      checked_at: new Date().toISOString(),
    }, {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return internalErrorResponse('Reference fleet heartbeat failed', error, {
      code: 'reference_fleet_heartbeat_failed',
      message: 'The managed reference fleet could not refresh presence.',
      status: 503,
    })
  }
}
