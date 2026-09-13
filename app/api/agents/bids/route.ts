import { NextRequest, NextResponse } from 'next/server'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { getAgentBids } from '@/lib/agent-work'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveRegisteredAgentRequest(request)
    if (auth.kind !== 'agent') return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    return NextResponse.json({ agent_id: auth.agentId, bids: await getAgentBids(auth.agentId) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[agents/bids]', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
