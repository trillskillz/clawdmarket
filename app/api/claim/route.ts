import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agents } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

/**
 * POST /api/claim
 *
 * Human claims an agent by providing the claim code and their email.
 * Sets the agent to active and records the owner.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { code, email } = body

    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { error: 'invalid_body', message: 'Claim code is required' },
        { status: 400 }
      )
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'Valid email is required' },
        { status: 400 }
      )
    }

    // Find agent by claim code
    const agent = await db.select({
      id: agents.id,
      name: agents.name,
      status: agents.status,
      claimCode: agents.claimCode,
      claimedAt: agents.claimedAt,
    })
      .from(agents)
      .where(eq(agents.claimCode, code))
      .get()

    if (!agent) {
      return NextResponse.json(
        { error: 'not_found', message: 'Invalid claim code' },
        { status: 404 }
      )
    }

    if (agent.claimedAt) {
      return NextResponse.json(
        { error: 'already_claimed', message: 'This agent has already been claimed' },
        { status: 409 }
      )
    }

    // Claim the agent — set active, record owner email and timestamp
    const nowIso = new Date().toISOString()
    await db.update(agents)
      .set({
        status: 'active',
        owner_address: email.trim().toLowerCase(),
        claimedAt: nowIso,
      })
      .where(eq(agents.id, agent.id))

    return NextResponse.json({
      ok: true,
      agent_id: agent.id,
      agent_name: agent.name,
      claimed_by: email.trim().toLowerCase(),
      claimed_at: nowIso,
      profile_url: `https://clawdmkt.com/registry/${agent.id}`,
      message: 'Agent claimed successfully! Your agent is now active on ClawdMarket.',
    })
  } catch (err: any) {
    console.error('[claim]', err)
    return NextResponse.json(
      { error: 'claim_failed', message: err.message },
      { status: 500 }
    )
  }
}

/**
 * GET /api/claim?code=xxx
 *
 * Look up agent info by claim code (used by the claim page).
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')

  if (!code) {
    return NextResponse.json(
      { error: 'missing_code', message: 'Provide ?code=claim_xxx' },
      { status: 400 }
    )
  }

  try {
    const agent = await db.select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      capabilities: agents.capabilities,
      status: agents.status,
      claimedAt: agents.claimedAt,
      created_at: agents.created_at,
    })
      .from(agents)
      .where(eq(agents.claimCode, code))
      .get()

    if (!agent) {
      return NextResponse.json(
        { error: 'not_found', message: 'Invalid claim code' },
        { status: 404 }
      )
    }

    let caps: string[] = []
    try { caps = JSON.parse(agent.capabilities || '[]') } catch { /* */ }

    return NextResponse.json({
      agent_id: agent.id,
      name: agent.name,
      description: agent.description,
      capabilities: caps,
      already_claimed: !!agent.claimedAt,
      created_at: agent.created_at,
    })
  } catch (err: any) {
    console.error('[claim/get]', err)
    return NextResponse.json(
      { error: 'internal_error', message: err.message },
      { status: 500 }
    )
  }
}
