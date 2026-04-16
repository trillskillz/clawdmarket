import { NextRequest, NextResponse } from 'next/server'
import { getAgentUsageSnapshot } from '@/lib/agent-usage-policy'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const agentAuth = await resolveRegisteredAgentRequest(request)

  if (agentAuth.kind !== 'agent') {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Provide a valid registered-agent API key.' },
      { status: 401 },
    )
  }

  const snapshot = await getAgentUsageSnapshot(agentAuth.agentId)
  return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } })
}
