import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agents } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

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
    const agent = await db.select({
      id: agents.id,
      name: agents.name,
      status: agents.status,
      claimCode: agents.claimCode,
      claimedAt: agents.claimedAt,
      owner_address: agents.owner_address,
      created_at: agents.created_at,
    })
      .from(agents)
      .where(eq(agents.api_key, apiKey))
      .get()

    if (!agent) {
      return NextResponse.json(
        { error: 'not_found', message: 'No agent found for this API key' },
        { status: 404 }
      )
    }

    const isClaimed = agent.status === 'active' && !!agent.claimedAt
    const isPendingClaim = agent.status === 'inactive' && !!agent.claimCode && !agent.claimedAt

    let status: string
    if (isClaimed) {
      status = 'claimed'
    } else if (isPendingClaim) {
      status = 'pending_claim'
    } else {
      status = agent.status
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://clawdmkt.com'

    return NextResponse.json({
      agent_id: agent.id,
      name: agent.name,
      status,
      claimed_at: agent.claimedAt || null,
      owner: agent.owner_address || null,
      claim_url: isPendingClaim ? `${baseUrl}/claim/${agent.claimCode}` : undefined,
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
