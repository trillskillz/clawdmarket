import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { internalErrorResponse } from '@/lib/api-error'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { acceptOwnershipTransfer, findOwnershipTransfer } from '@/lib/agent-ownership'
import { validateCsrf } from '@/lib/csrf'
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const acceptSchema = z.object({
  token: z.string().trim().regex(/^clawd_transfer_[a-f0-9]{64}$/),
})

export async function POST(request: NextRequest) {
  try {
    const account = await resolveAuthenticatedOwnerAccount(request)
    if (!account) return NextResponse.json({ error: 'account_auth_required' }, { status: 401 })
    if (account.usesCookieAuth && !validateCsrf(request)) {
      return NextResponse.json({ error: 'csrf_validation_failed' }, { status: 403 })
    }
    const parsed = acceptSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    const rl = await rateLimit(`agent-ownership-accept:${account.userId}`, {
      interval: 60 * 60 * 1000,
      maxRequests: 10,
      failClosed: true,
    })
    const rateHeaders = getRateLimitHeaders(rl)
    if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: rateHeaders })

    const transfer = await findOwnershipTransfer(parsed.data.token)
    if (!transfer) return NextResponse.json({ error: 'invalid_transfer' }, { status: 404, headers: rateHeaders })
    if (transfer.acceptedAt || transfer.cancelledAt || transfer.expiresAt <= Math.floor(Date.now() / 1000)) {
      return NextResponse.json({ error: 'transfer_unavailable' }, { status: 409, headers: rateHeaders })
    }
    const identityMatches = transfer.targetType === 'wallet'
      ? account.walletAddress === transfer.targetValue
      : account.email === transfer.targetValue
    if (!identityMatches) {
      return NextResponse.json({ error: 'transfer_target_mismatch' }, { status: 403, headers: rateHeaders })
    }

    const result = await acceptOwnershipTransfer({
      token: parsed.data.token,
      transferId: transfer.id,
      agentId: transfer.agentId,
      acceptingUserId: account.userId,
      targetType: transfer.targetType,
      targetValue: transfer.targetValue,
    })
    if (result.kind === 'conflict') return NextResponse.json({ error: 'transfer_conflict' }, { status: 409, headers: rateHeaders })
    return NextResponse.json({
      ok: true,
      agent_id: result.agent_id,
      transferred_at: result.accepted_at,
      credential: { api_key: result.api_key, prefix: result.prefix },
      named_credentials_revoked: result.named_credentials_revoked,
      warning: 'Save credential.api_key now. Acceptance revoked all credentials held by the prior owner.',
    }, { headers: { ...rateHeaders, 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return internalErrorResponse('Ownership transfer acceptance failed', error)
  }
}
