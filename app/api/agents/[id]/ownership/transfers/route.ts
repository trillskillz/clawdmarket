import { NextRequest, NextResponse } from 'next/server'
import { isAddress } from 'viem'
import { z } from 'zod'
import { internalErrorResponse } from '@/lib/api-error'
import { accountOwnsAgent, resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { createOwnershipTransfer } from '@/lib/agent-ownership'
import { validateCsrf } from '@/lib/csrf'
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const transferSchema = z.object({
  target_email: z.string().trim().email().max(254).optional(),
  target_wallet: z.string().trim().max(42).optional(),
}).refine((body) => Number(Boolean(body.target_email)) + Number(Boolean(body.target_wallet)) === 1, {
  message: 'Provide exactly one of target_email or target_wallet.',
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await resolveAuthenticatedOwnerAccount(request)
    if (!account) return NextResponse.json({ error: 'account_auth_required' }, { status: 401 })
    if (account.usesCookieAuth && !validateCsrf(request)) {
      return NextResponse.json({ error: 'csrf_validation_failed' }, { status: 403 })
    }
    const { id } = await params
    if (!(await accountOwnsAgent(account.userId, id))) {
      return NextResponse.json({ error: 'owner_required' }, { status: 403 })
    }
    const parsed = transferSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'invalid_body', details: parsed.error.issues }, { status: 400 })

    const targetType = parsed.data.target_wallet ? 'wallet' : 'email'
    const targetValue = targetType === 'wallet'
      ? parsed.data.target_wallet!.toLowerCase()
      : parsed.data.target_email!.toLowerCase()
    if (targetType === 'wallet' && !isAddress(targetValue as `0x${string}`)) {
      return NextResponse.json({ error: 'invalid_target_wallet' }, { status: 400 })
    }
    if (targetValue === account.email || targetValue === account.walletAddress) {
      return NextResponse.json({ error: 'same_owner', message: 'Transfer target must be a different account.' }, { status: 409 })
    }

    const rl = await rateLimit(`agent-ownership-transfer:${id}:${account.userId}`, {
      interval: 24 * 60 * 60 * 1000,
      maxRequests: 3,
      failClosed: true,
    })
    const rateHeaders = getRateLimitHeaders(rl)
    if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: rateHeaders })
    const result = await createOwnershipTransfer({
      agentId: id,
      ownerUserId: account.userId,
      targetType,
      targetValue,
    })
    if (result.kind === 'forbidden') return NextResponse.json({ error: 'owner_required' }, { status: 403, headers: rateHeaders })
    if (result.kind === 'conflict') return NextResponse.json({ error: 'transfer_conflict' }, { status: 409, headers: rateHeaders })

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://clawdmkt.com'
    return NextResponse.json({
      ok: true,
      agent_id: id,
      transfer: {
        id: result.id,
        target_type: result.target_type,
        target_value: result.target_value,
        expires_at: result.expires_at,
        accept_token: result.token,
        accept_url: `${baseUrl}/auth/login?next=${encodeURIComponent(`/ownership/accept?token=${result.token}`)}`,
      },
      warning: 'Share the acceptance URL privately. The token is shown once and expires in 24 hours.',
    }, { status: 201, headers: { ...rateHeaders, 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return internalErrorResponse('Ownership transfer creation failed', error)
  }
}
