import { NextRequest, NextResponse } from 'next/server'
import { internalErrorResponse } from '@/lib/api-error'
import { revokePreviousAgentCredential } from '@/lib/agent-credentials'
import {
  registeredAgentApiKeyFromRequest,
  resolveRegisteredAgentRequest,
} from '@/lib/registered-agent-auth'
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function DELETE(request: NextRequest) {
  try {
    const auth = await resolveRegisteredAgentRequest(request)
    if (auth.kind !== 'agent') {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Provide a valid active agent API key.' },
        { status: 401 },
      )
    }
    if (auth.credential !== 'current') {
      return NextResponse.json({
        error: 'current_credential_required',
        message: 'Authenticate with the current key to revoke the previous overlap key.',
      }, { status: 403 })
    }

    const rl = await rateLimit(`agent-credential-revoke-previous:${auth.agentId}`, {
      interval: 60 * 60 * 1000,
      maxRequests: 10,
      failClosed: true,
    })
    const rateHeaders = getRateLimitHeaders(rl)
    if (!rl.success) {
      return NextResponse.json({
        error: 'rate_limited',
        message: 'Too many credential revocation attempts. Retry after the rate-limit reset.',
      }, { status: 429, headers: rateHeaders })
    }

    const result = await revokePreviousAgentCredential({
      agentId: auth.agentId,
      currentApiKey: registeredAgentApiKeyFromRequest(request),
    })
    if (result.kind === 'not_found') {
      return NextResponse.json({ error: 'not_found', message: 'Agent not found.' }, { status: 404, headers: rateHeaders })
    }
    if (result.kind === 'inactive') {
      return NextResponse.json({ error: 'inactive_agent', message: 'Only an active, unarchived agent can revoke overlap credentials.' }, { status: 409, headers: rateHeaders })
    }
    if (result.kind === 'conflict') {
      return NextResponse.json({
        error: 'credential_conflict',
        message: 'The current credential changed concurrently. Check agent status before retrying.',
      }, { status: 409, headers: rateHeaders })
    }
    if (result.kind === 'already_revoked') {
      return NextResponse.json({ ok: true, agent_id: auth.agentId, revoked: false, status: 'no_previous_key' }, {
        headers: { ...rateHeaders, 'Cache-Control': 'private, no-store' },
      })
    }

    return NextResponse.json({
      ok: true,
      agent_id: auth.agentId,
      revoked: true,
      previous_prefix: result.previous_prefix,
      revoked_at: result.revoked_at,
    }, { headers: { ...rateHeaders, 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return internalErrorResponse('Previous agent credential revocation failed', error)
  }
}
