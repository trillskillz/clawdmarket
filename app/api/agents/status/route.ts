import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/agents/status
 *
 * Agent checks its own status using its API key.
 * Returns claimed/pending_claim/inactive status.
 */
export async function GET(request: NextRequest) {
  try {
    const client = (db as any).$client

    const auth = await resolveRegisteredAgentRequest(request, { allowInactive: true })
    if (auth.kind !== 'agent') {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Invalid API key' },
        { status: 401 }
      )
    }

    const result = await client.execute({
      sql: `SELECT id, name, status, owner_address, owner_email, created_at, claim_code, claimed_at
            FROM agents WHERE id = ? LIMIT 1`,
      args: [auth.agentId],
    })
    const agent = result?.rows?.[0]
    if (!agent) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Invalid API key' },
        { status: 401 }
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
      activation_method: isClaimed ? 'owner_claim' : agentStatus === 'active' ? 'autonomous' : 'owner_claim',
      human_approval_required: isPendingClaim,
      claimed_at: claimedAt || null,
      owner_address: agent.owner_address || null,
      owner_email: agent.owner_email || null,
      claim_url: isPendingClaim ? `${baseUrl}/claim/${claimCode}` : undefined,
      profile_url: `${baseUrl}/registry/${agent.id}`,
    })
  } catch (err: any) {
    return internalErrorResponse('Agent status lookup failed', err)
  }
}
