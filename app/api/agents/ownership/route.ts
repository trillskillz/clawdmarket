import { NextRequest, NextResponse } from 'next/server'
import { internalErrorResponse } from '@/lib/api-error'
import {
  ownerLinkIdentityMatchesAgent,
  resolveAuthenticatedOwnerAccount,
} from '@/lib/agent-owner-auth'
import { linkAgentOwner, listOwnedAgents } from '@/lib/agent-ownership'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { validateCsrf } from '@/lib/csrf'
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const account = await resolveAuthenticatedOwnerAccount(request)
    if (!account) return NextResponse.json({ error: 'account_auth_required' }, { status: 401 })
    const ownedAgents = await listOwnedAgents(account.userId)
    return NextResponse.json({ owned_agents: ownedAgents }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return internalErrorResponse('Owned agents fetch failed', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const account = await resolveAuthenticatedOwnerAccount(request)
    if (!account) return NextResponse.json({ error: 'account_auth_required' }, { status: 401 })
    if (account.usesCookieAuth && !validateCsrf(request)) {
      return NextResponse.json({ error: 'csrf_validation_failed' }, { status: 403 })
    }

    const agentAuth = await resolveRegisteredAgentRequest(request)
    if (agentAuth.kind === 'forbidden') {
      return NextResponse.json({ error: 'insufficient_scope', required_scope: agentAuth.requiredScope }, { status: 403 })
    }
    if (agentAuth.kind !== 'agent') {
      return NextResponse.json({ error: 'agent_auth_required', message: 'Send the agent key in X-Agent-API-Key.' }, { status: 401 })
    }
    if (agentAuth.credential !== 'current') {
      return NextResponse.json({
        error: 'primary_credential_required',
        message: 'Only the current primary credential can establish a recovery owner.',
      }, { status: 403 })
    }

    const rl = await rateLimit(`agent-owner-link:${agentAuth.agentId}:${account.userId}`, {
      interval: 24 * 60 * 60 * 1000,
      maxRequests: 5,
      failClosed: true,
    })
    const rateHeaders = getRateLimitHeaders(rl)
    if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: rateHeaders })

    const identity = await ownerLinkIdentityMatchesAgent(account, agentAuth.agentId)
    if (identity.kind === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404, headers: rateHeaders })
    if (identity.kind === 'mismatch') {
      return NextResponse.json({
        error: 'owner_identity_mismatch',
        message: `Sign in with the agent's declared owner ${identity.required}.`,
      }, { status: 403, headers: rateHeaders })
    }

    const result = await linkAgentOwner({
      agentId: agentAuth.agentId,
      userId: account.userId,
      establishedBy: 'account_and_agent_key',
    })
    if (result.kind === 'conflict') {
      return NextResponse.json({ error: 'owner_already_linked', message: 'This agent already has a recovery owner.' }, {
        status: 409,
        headers: rateHeaders,
      })
    }
    return NextResponse.json({
      ok: true,
      agent_id: agentAuth.agentId,
      owner_user_id: account.userId,
      linked_at: result.linked_at,
      recovery_enabled: true,
    }, { headers: { ...rateHeaders, 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return internalErrorResponse('Agent owner link failed', error)
  }
}
