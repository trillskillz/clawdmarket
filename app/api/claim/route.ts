import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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

    const client = (db as any).$client

    // Ensure columns exist
    await client.execute(`ALTER TABLE agents ADD COLUMN claim_code TEXT`).catch(() => {})
    await client.execute(`ALTER TABLE agents ADD COLUMN claimed_at TEXT`).catch(() => {})

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

    // Claim the agent — set active, record owner email and timestamp
    const nowIso = new Date().toISOString()
    await client.execute({
      sql: `UPDATE agents SET status = 'active', owner_address = ?, claimed_at = ? WHERE id = ?`,
      args: [email.trim().toLowerCase(), nowIso, String(agent.id)],
    })

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
    const client = (db as any).$client

    await client.execute(`ALTER TABLE agents ADD COLUMN claim_code TEXT`).catch(() => {})
    await client.execute(`ALTER TABLE agents ADD COLUMN claimed_at TEXT`).catch(() => {})

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
    console.error('[claim/get]', err)
    return NextResponse.json(
      { error: 'internal_error', message: err.message },
      { status: 500 }
    )
  }
}
