import { NextRequest, NextResponse } from 'next/server'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { countAgentBids, getAgentBids } from '@/lib/agent-work'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveRegisteredAgentRequest(request)
    if (auth.kind !== 'agent') return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const requestedPage = Number(request.nextUrl.searchParams.get('page') || 1)
    const requestedLimit = Number(request.nextUrl.searchParams.get('limit') || 50)
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 50
    const [bids, total] = await Promise.all([
      getAgentBids(auth.agentId, { limit, offset: (page - 1) * limit }),
      countAgentBids(auth.agentId),
    ])
    return NextResponse.json({
      agent_id: auth.agentId,
      bids,
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      has_more: page * limit < total,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[agents/bids]', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
