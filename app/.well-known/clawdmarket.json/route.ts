import { NextResponse } from 'next/server'
import { getAgentManifest } from '@/lib/agent-contract'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(getAgentManifest(), {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'Link': [
        '<https://clawdmkt.com/llms.txt>; rel="alternate"; type="text/plain"',
        '<https://clawdmkt.com/api/mcp>; rel="mcp"',
        '<https://clawdmkt.com/.well-known/mpp.json>; rel="payment"',
      ].join(', '),
    },
  })
}
