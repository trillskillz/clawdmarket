import { NextRequest, NextResponse } from 'next/server'
import { internalErrorResponse } from '@/lib/api-error'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { cancelOwnershipTransfer } from '@/lib/agent-ownership'
import { validateCsrf } from '@/lib/csrf'
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; transferId: string }> },
) {
  try {
    const account = await resolveAuthenticatedOwnerAccount(request)
    if (!account) return NextResponse.json({ error: 'account_auth_required' }, { status: 401 })
    if (account.usesCookieAuth && !validateCsrf(request)) {
      return NextResponse.json({ error: 'csrf_validation_failed' }, { status: 403 })
    }
    const { id, transferId } = await params
    if (!/^aot_[0-9a-f-]{36}$/i.test(transferId)) {
      return NextResponse.json({ error: 'invalid_transfer_id' }, { status: 400 })
    }
    const rl = await rateLimit(`agent-ownership-transfer-cancel:${id}:${account.userId}`, {
      interval: 60 * 60 * 1000,
      maxRequests: 20,
      failClosed: true,
    })
    const rateHeaders = getRateLimitHeaders(rl)
    if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: rateHeaders })
    const result = await cancelOwnershipTransfer({
      agentId: id,
      transferId,
      ownerUserId: account.userId,
    })
    if (result.kind === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404, headers: rateHeaders })
    return NextResponse.json(
      { ok: true, agent_id: id, transfer_id: transferId, cancelled: true },
      { headers: { ...rateHeaders, 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    return internalErrorResponse('Ownership transfer cancellation failed', error)
  }
}
