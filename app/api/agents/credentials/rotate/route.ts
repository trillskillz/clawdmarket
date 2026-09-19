import { NextRequest, NextResponse } from 'next/server'
import { internalErrorResponse } from '@/lib/api-error'
import { rotateAgentCredential } from '@/lib/agent-credentials'
import {
  registeredAgentApiKeyFromRequest,
  resolveRegisteredAgentRequest,
} from '@/lib/registered-agent-auth'
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
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
        message: 'The previous overlap key cannot rotate credentials. Retry with the current key.',
      }, { status: 403 })
    }

    const rl = await rateLimit(`agent-credential-rotate:${auth.agentId}`, {
      interval: 60 * 60 * 1000,
      maxRequests: 3,
      failClosed: true,
    })
    const rateHeaders = getRateLimitHeaders(rl)
    if (!rl.success) {
      return NextResponse.json({
        error: 'rate_limited',
        message: 'Too many credential rotation attempts. Retry after the rate-limit reset.',
      }, { status: 429, headers: rateHeaders })
    }

    const result = await rotateAgentCredential({
      agentId: auth.agentId,
      currentApiKey: registeredAgentApiKeyFromRequest(request),
    })
    if (result.kind === 'not_found') {
      return NextResponse.json({ error: 'not_found', message: 'Agent not found.' }, { status: 404, headers: rateHeaders })
    }
    if (result.kind === 'inactive') {
      return NextResponse.json({ error: 'inactive_agent', message: 'Only an active, unarchived agent can rotate credentials.' }, { status: 409, headers: rateHeaders })
    }
    if (result.kind === 'overlap_active') {
      return NextResponse.json({
        error: 'rotation_overlap_active',
        message: 'A previous-key overlap is already active. Verify the current key, then revoke the previous key before rotating again.',
        previous_key_valid_until: result.previous_valid_until,
        next_action: { method: 'DELETE', endpoint: '/api/agents/credentials/previous', auth: 'current_agent_api_key' },
      }, { status: 409, headers: rateHeaders })
    }
    if (result.kind === 'conflict') {
      return NextResponse.json({
        error: 'rotation_conflict',
        message: 'The credential changed concurrently. Check agent status before retrying.',
      }, { status: 409, headers: rateHeaders })
    }

    return NextResponse.json({
      ok: true,
      agent_id: auth.agentId,
      credential: {
        api_key: result.api_key,
        prefix: result.prefix,
        rotated_at: result.rotated_at,
        previous_prefix: result.previous_prefix,
        previous_key_valid_until: result.previous_valid_until,
      },
      warning: 'Save credential.api_key now. It will not be shown again.',
      next_actions: [
        { action: 'verify_current_key', method: 'GET', endpoint: '/api/agents/status', auth: 'new_agent_api_key' },
        { action: 'revoke_previous_key', method: 'DELETE', endpoint: '/api/agents/credentials/previous', auth: 'new_agent_api_key' },
      ],
    }, { status: 200, headers: { ...rateHeaders, 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return internalErrorResponse('Agent credential rotation failed', error)
  }
}
