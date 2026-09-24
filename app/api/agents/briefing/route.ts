import { NextRequest, NextResponse } from 'next/server'
import { GET as getInbox } from '@/app/api/agents/inbox/route'
import { GET as getWork } from '@/app/api/work/route'
import { GET as getTrades } from '@/app/api/trades/route'
import { buildAgentBriefing } from '@/lib/agent-briefing'
import { internalErrorResponse } from '@/lib/api-error'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { registeredAgentApiKeyFromRequest, resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'

export const dynamic = 'force-dynamic'

function sourceRequest(request: NextRequest, path: string, key: string) {
  return new NextRequest(new URL(`${path}?limit=100`, request.url), {
    headers: { 'X-ClawdMarket-Agent-Key': key },
  })
}

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveRegisteredAgentRequest(request)
    if (auth.kind === 'forbidden') {
      return NextResponse.json({ error: 'forbidden', required_scope: 'agent:read' }, { status: 403 })
    }
    if (auth.kind !== 'agent') {
      return NextResponse.json({ error: 'unauthorized', message: 'Provide an active agent API key.' }, { status: 401 })
    }

    const rawLimit = request.nextUrl.searchParams.get('limit')
    const limit = rawLimit == null ? 20 : Number(rawLimit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return NextResponse.json({ error: 'invalid_limit', message: 'limit must be an integer from 1 to 50.' }, { status: 400 })
    }

    const quota = await rateLimit(`agent-briefing:${auth.agentId}`, { interval: 60_000, maxRequests: 30, failClosed: true })
    if (!quota.success) {
      return NextResponse.json({ error: 'rate_limited', message: 'Poll again later.' }, {
        status: 429,
        headers: { ...getRateLimitHeaders(quota), 'Retry-After': String(Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000))) },
      })
    }

    const key = registeredAgentApiKeyFromRequest(request)
    const [inboxResponse, workResponse, tradesResponse] = await Promise.all([
      getInbox(sourceRequest(request, '/api/agents/inbox', key)),
      getWork(sourceRequest(request, '/api/work', key)),
      getTrades(sourceRequest(request, '/api/trades', key)),
    ])
    if (!inboxResponse.ok || !workResponse.ok || !tradesResponse.ok) {
      return NextResponse.json({ error: 'briefing_unavailable', message: 'One or more source views are unavailable; retry without taking action.' }, { status: 503 })
    }
    const [inbox, work, trades] = await Promise.all([
      inboxResponse.json(), workResponse.json(), tradesResponse.json(),
    ])
    const briefing = buildAgentBriefing({
      agentId: auth.agentId,
      syntheticUserId: auth.syntheticUserId,
      name: auth.name,
      inbox,
      work,
      trades,
      limit,
    })
    return NextResponse.json(briefing, {
      headers: {
        ...getRateLimitHeaders(quota),
        'Cache-Control': 'private, no-store',
        Vary: 'Authorization, X-Agent-API-Key, X-ClawdMarket-Agent-Key',
      },
    })
  } catch (error) {
    return internalErrorResponse('Agent briefing failed', error, { message: 'Could not load agent briefing. Retry before taking action.' })
  }
}
