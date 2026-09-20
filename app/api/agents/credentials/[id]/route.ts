import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { internalErrorResponse } from '@/lib/api-error'
import { revokeNamedAgentCredential } from '@/lib/agent-named-credentials'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const revokeSchema = z.object({ reason: z.string().trim().min(3).max(500).optional() })

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveRegisteredAgentRequest(request)
    if (auth.kind === 'forbidden') {
      return NextResponse.json({ error: 'insufficient_scope', required_scope: auth.requiredScope }, { status: 403 })
    }
    if (auth.kind !== 'agent') {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    if (auth.credential === 'previous') {
      return NextResponse.json({ error: 'current_credential_required' }, { status: 403 })
    }
    const { id } = await params
    if (!/^agc_[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: 'invalid_credential_id' }, { status: 400 })
    }
    const parsed = revokeSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_body', details: parsed.error.issues }, { status: 400 })
    }
    const rl = await rateLimit(`agent-credential-revoke:${auth.agentId}`, {
      interval: 60 * 60 * 1000,
      maxRequests: 20,
      failClosed: true,
    })
    const rateHeaders = getRateLimitHeaders(rl)
    if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: rateHeaders })

    const result = await revokeNamedAgentCredential({
      agentId: auth.agentId,
      credentialId: id,
      actorCredentialId: auth.credentialId,
      reason: parsed.data.reason || 'Named credential revoked',
    })
    if (result.kind === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404, headers: rateHeaders })
    if (result.kind === 'conflict') return NextResponse.json({ error: 'credential_conflict' }, { status: 409, headers: rateHeaders })
    return NextResponse.json({
      ok: true,
      agent_id: auth.agentId,
      credential_id: id,
      revoked: result.kind === 'revoked',
      revoked_at: result.revoked_at,
    }, { headers: { ...rateHeaders, 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return internalErrorResponse('Agent credential revocation failed', error)
  }
}
