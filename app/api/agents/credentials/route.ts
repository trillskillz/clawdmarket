import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { internalErrorResponse } from '@/lib/api-error'
import {
  createNamedAgentCredential,
  listAgentCredentials,
  MAX_ACTIVE_NAMED_AGENT_CREDENTIALS,
} from '@/lib/agent-named-credentials'
import { AGENT_CREDENTIAL_SCOPES } from '@/lib/agent-credential-scopes'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const createCredentialSchema = z.object({
  name: z.string().trim().min(3).max(80),
  scopes: z.array(z.enum(AGENT_CREDENTIAL_SCOPES)).min(1).max(AGENT_CREDENTIAL_SCOPES.length)
    .transform((scopes) => [...new Set(scopes)]),
  expires_in_days: z.coerce.number().int().min(1).max(365).optional(),
})

function authError(auth: Awaited<ReturnType<typeof resolveRegisteredAgentRequest>>) {
  if (auth.kind === 'forbidden') {
    return NextResponse.json({
      error: 'insufficient_scope',
      message: `This credential requires the ${auth.requiredScope} scope.`,
      required_scope: auth.requiredScope,
    }, { status: 403 })
  }
  return NextResponse.json({ error: 'unauthorized', message: 'Provide a valid active agent API key.' }, { status: 401 })
}

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveRegisteredAgentRequest(request)
    if (auth.kind !== 'agent') return authError(auth)
    if (auth.credential === 'previous') {
      return NextResponse.json({ error: 'current_credential_required' }, { status: 403 })
    }
    const credentials = await listAgentCredentials(auth.agentId)
    return NextResponse.json({
      agent_id: auth.agentId,
      max_active_named_credentials: MAX_ACTIVE_NAMED_AGENT_CREDENTIALS,
      credentials,
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return internalErrorResponse('Agent credentials fetch failed', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveRegisteredAgentRequest(request)
    if (auth.kind !== 'agent') return authError(auth)
    if (auth.credential === 'previous') {
      return NextResponse.json({ error: 'current_credential_required' }, { status: 403 })
    }
    const rl = await rateLimit(`agent-credential-create:${auth.agentId}`, {
      interval: 24 * 60 * 60 * 1000,
      maxRequests: 10,
      failClosed: true,
    })
    const rateHeaders = getRateLimitHeaders(rl)
    if (!rl.success) {
      return NextResponse.json({ error: 'rate_limited', message: 'Named credential creation limit reached.' }, {
        status: 429,
        headers: rateHeaders,
      })
    }

    const parsed = createCredentialSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_body', details: parsed.error.issues }, { status: 400, headers: rateHeaders })
    }
    const escalatedScopes = parsed.data.scopes.filter((scope) => !auth.scopes.includes(scope))
    if (escalatedScopes.length > 0) {
      return NextResponse.json({
        error: 'scope_escalation_forbidden',
        message: 'A named credential may only delegate scopes held by the calling credential.',
        forbidden_scopes: escalatedScopes,
      }, { status: 403, headers: rateHeaders })
    }
    const result = await createNamedAgentCredential({
      agentId: auth.agentId,
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      expiresInDays: parsed.data.expires_in_days,
      actorCredentialId: auth.credentialId,
    })
    if (result.kind === 'conflict') {
      return NextResponse.json({
        error: 'credential_conflict',
        message: `An active credential already uses that name, or the ${MAX_ACTIVE_NAMED_AGENT_CREDENTIALS}-credential limit was reached.`,
      }, { status: 409, headers: rateHeaders })
    }
    return NextResponse.json({
      ok: true,
      agent_id: auth.agentId,
      credential: {
        id: result.id,
        api_key: result.api_key,
        name: result.name,
        prefix: result.prefix,
        scopes: result.scopes,
        created_at: result.created_at,
        expires_at: result.expires_at,
      },
      warning: 'Save credential.api_key now. It will not be shown again.',
    }, { status: 201, headers: { ...rateHeaders, 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return internalErrorResponse('Agent credential creation failed', error)
  }
}
