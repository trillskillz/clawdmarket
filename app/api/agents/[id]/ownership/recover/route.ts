import { NextRequest, NextResponse } from 'next/server'
import { internalErrorResponse } from '@/lib/api-error'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { recoverAgentCredentials } from '@/lib/agent-ownership'
import { validateCsrf } from '@/lib/csrf'
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await resolveAuthenticatedOwnerAccount(request)
    if (!account) return NextResponse.json({ error: 'account_auth_required' }, { status: 401 })
    if (account.usesCookieAuth && !validateCsrf(request)) {
      return NextResponse.json({ error: 'csrf_validation_failed' }, { status: 403 })
    }
    const { id } = await params
    if (!/^(agent_|av_)[A-Za-z0-9-]{8,}$/.test(id)) {
      return NextResponse.json({ error: 'invalid_agent_id' }, { status: 400 })
    }
    const rl = await rateLimit(`agent-owner-recovery:${id}:${account.userId}`, {
      interval: 24 * 60 * 60 * 1000,
      maxRequests: 3,
      failClosed: true,
    })
    const rateHeaders = getRateLimitHeaders(rl)
    if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: rateHeaders })

    const result = await recoverAgentCredentials({ agentId: id, ownerUserId: account.userId })
    if (result.kind === 'forbidden') {
      return NextResponse.json({ error: 'owner_required', message: 'This account is not the linked recovery owner.' }, {
        status: 403,
        headers: rateHeaders,
      })
    }
    if (result.kind === 'conflict') return NextResponse.json({ error: 'recovery_conflict' }, { status: 409, headers: rateHeaders })
    return NextResponse.json({
      ok: true,
      agent_id: id,
      credential: {
        api_key: result.api_key,
        prefix: result.prefix,
        recovered_at: result.recovered_at,
      },
      named_credentials_revoked: result.named_credentials_revoked,
      warning: 'Save credential.api_key now. Recovery revoked every prior primary, overlap, and named credential.',
    }, { headers: { ...rateHeaders, 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return internalErrorResponse('Owner-assisted credential recovery failed', error)
  }
}
