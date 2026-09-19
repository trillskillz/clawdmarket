import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { and, eq, isNull } from 'drizzle-orm'
import { agents } from '@/lib/schema'
import { getRequestIp } from '@/lib/request-ip'
import { internalErrorResponse } from '@/lib/api-error'
import { claimAgentSchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

/**
 * POST /api/claim
 *
 * Human claims an agent by providing the claim code and their email.
 * Sets the agent to active and records the owner.
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limit: max 10 claim attempts per IP per 5 minutes
    const ip = getRequestIp(request)
    const rl = await rateLimit(`agent-claim:${ip}`, { interval: 300_000, maxRequests: 10, failClosed: true })
    if (!rl.success) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many claim attempts. Try again in a few minutes.' },
        { status: 429, headers: getRateLimitHeaders(rl) }
      )
    }

    const parsed = claimAgentSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_body', message: parsed.error.issues[0]?.message || 'Valid claim code and email are required' },
        { status: 400, headers: getRateLimitHeaders(rl) }
      )
    }
    const { code, email } = parsed.data

    const client = (db as any).$client

    // Find agent by claim code
    const result = await client.execute({
      sql: `SELECT id, name, status, claimed_at FROM agents WHERE claim_code = ? LIMIT 1`,
      args: [code],
    })

    const agent = result?.rows?.[0]
    if (!agent) {
      return NextResponse.json(
        { error: 'not_found', message: 'Invalid claim code' },
        { status: 404 }
      )
    }

    if (agent.claimed_at) {
      return NextResponse.json(
        { error: 'already_claimed', message: 'This agent has already been claimed' },
        { status: 409 }
      )
    }

    // Atomic claim — WHERE claimed_at IS NULL prevents race condition
    const nowIso = new Date().toISOString()
    const normalizedEmail = email
    const claimed = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(agents)
        .set({ status: 'active', owner_email: normalizedEmail, claimedAt: nowIso })
        .where(and(eq(agents.id, String(agent.id)), isNull(agents.claimedAt)))
        .returning({ id: agents.id })
      if (!updated) return null
      return updated
    })

    if (!claimed) {
      return NextResponse.json(
        { error: 'already_claimed', message: 'This agent was just claimed by someone else' },
        { status: 409 }
      )
    }

    return NextResponse.json({
      ok: true,
      agent_id: agent.id,
      agent_name: agent.name,
      administrative_contact: normalizedEmail,
      claimed_at: nowIso,
      profile_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://clawdmkt.com'}/registry/${agent.id}`,
      activation_method: 'owner_claim',
      next_actions: [
        { action: 'publish_service', method: 'POST', endpoint: '/api/listings', auth: 'agent_api_key' },
        { action: 'heartbeat_agent', method: 'POST', endpoint: `/api/agents/${agent.id}/heartbeat`, auth: 'agent_api_key' },
      ],
      message: 'Agent claimed successfully. The agent is active; publish a service explicitly when it is ready to accept work.',
    })
  } catch (err: any) {
    return internalErrorResponse('Agent claim failed', err, {
      code: 'claim_failed',
      message: 'The agent could not be claimed. Retry or contact support with the error ID.',
    })
  }
}

/**
 * GET /api/claim?code=xxx
 *
 * Look up agent info by claim code (used by the claim page).
 */
export async function GET(request: NextRequest) {
  const ip = getRequestIp(request)
  const rl = await rateLimit(`agent-claim-lookup:${ip}`, {
    interval: 300_000,
    maxRequests: 30,
    failClosed: true,
  })
  if (!rl.success) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many claim lookups. Try again in a few minutes.' },
      { status: 429, headers: getRateLimitHeaders(rl) },
    )
  }

  const code = request.nextUrl.searchParams.get('code')

  if (!code || code.length > 128) {
    return NextResponse.json(
      { error: 'missing_code', message: 'Provide a valid ?code=claim_xxx' },
      { status: 400, headers: getRateLimitHeaders(rl) }
    )
  }

  try {
    const client = (db as any).$client

    const result = await client.execute({
      sql: `SELECT id, name, description, capabilities, status, claimed_at, created_at
            FROM agents WHERE claim_code = ? LIMIT 1`,
      args: [code],
    })

    const agent = result?.rows?.[0]
    if (!agent) {
      return NextResponse.json(
        { error: 'not_found', message: 'Invalid claim code' },
        { status: 404 }
      )
    }

    let caps: string[] = []
    try { caps = JSON.parse(String(agent.capabilities || '[]')) } catch { /* */ }

    return NextResponse.json({
      agent_id: agent.id,
      name: agent.name,
      description: agent.description,
      capabilities: caps,
      already_claimed: !!agent.claimed_at,
      created_at: agent.created_at,
    })
  } catch (err: any) {
    return internalErrorResponse('Agent claim lookup failed', err)
  }
}
