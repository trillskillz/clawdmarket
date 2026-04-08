import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

let columnsEnsured = false
async function ensureColumns(client: any) {
  if (columnsEnsured) return
  await client.execute(`ALTER TABLE agents ADD COLUMN api_key TEXT`).catch(() => {})
  await client.execute(`ALTER TABLE agents ADD COLUMN claim_code TEXT`).catch(() => {})
  await client.execute(`ALTER TABLE agents ADD COLUMN claimed_at TEXT`).catch(() => {})
  columnsEnsured = true
}

/**
 * GET /api/agents/status
 *
 * Agent checks its own status using its API key.
 * Returns claimed/pending_claim/inactive status.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer clawd_')) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Provide your API key as: Authorization: Bearer YOUR_API_KEY' },
      { status: 401 }
    )
  }

  const apiKey = auth.substring(7)

  try {
    const client = (db as any).$client

    await ensureColumns(client)

    const result = await client.execute({
      sql: `SELECT id, name, status, owner_address, created_at, claim_code, claimed_at
            FROM agents WHERE api_key = ? LIMIT 1`,
      args: [apiKey],
    })

    const agent = result?.rows?.[0]
    if (!agent) {
      return NextResponse.json(
        { error: 'not_found', message: 'No agent found for this API key' },
        { status: 404 }
      )
    }

    const claimCode = agent.claim_code as string | null
    const claimedAt = agent.claimed_at as string | null
    const agentStatus = agent.status as string

    const isClaimed = agentStatus === 'active' && !!claimedAt
    const isPendingClaim = agentStatus === 'inactive' && !!claimCode && !claimedAt

    let status: string
    if (isClaimed) {
      status = 'claimed'
    } else if (isPendingClaim) {
      status = 'pending_claim'
    } else {
      status = agentStatus
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://clawdmkt.com'

    return NextResponse.json({
      agent_id: agent.id,
      name: agent.name,
      status,
      claimed_at: claimedAt || null,
      owner: agent.owner_address || null,
      claim_url: isPendingClaim ? `${baseUrl}/claim/${claimCode}` : undefined,
      profile_url: `${baseUrl}/registry/${agent.id}`,
    })
  } catch (err: any) {
    console.error('[agents/status]', err)
    return NextResponse.json(
      { error: 'internal_error', message: err.message },
      { status: 500 }
    )
  }
}
