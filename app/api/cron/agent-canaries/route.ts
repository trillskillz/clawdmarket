import { NextRequest, NextResponse } from 'next/server'
import { archiveAgent, staleEphemeralAgentIds } from '@/lib/agent-lifecycle'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const STALE_AFTER_SECONDS = 2 * 60 * 60

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const ids = await staleEphemeralAgentIds(STALE_AFTER_SECONDS)
    const outcomes = []
    for (const agentId of ids) {
      const result = await archiveAgent({
        agentId,
        reason: 'Automatic cleanup of stale ephemeral production canary',
        actorType: 'canary_cleanup',
        actorId: 'cron:agent-canaries',
      })
      outcomes.push({ agent_id: agentId, result: result.kind })
    }
    const ok = outcomes.every((outcome) => outcome.result === 'archived' || outcome.result === 'already_archived')
    return NextResponse.json({
      ok,
      inspected: ids.length,
      outcomes,
    }, { status: ok ? 200 : 409, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return internalErrorResponse('Agent canary cleanup failed', error, {
      code: 'agent_canary_cleanup_failed',
      message: 'Stale ephemeral agents could not be cleaned up.',
      status: 503,
    })
  }
}
