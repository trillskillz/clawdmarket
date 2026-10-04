import { NextRequest } from 'next/server'
import { instantEndpoint, instantResponse, instantBody } from '@/lib/instant-api'
import { instantClaimInput, claimInstantCall } from '@/lib/instant-execution'
export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 return instantEndpoint(request, async principal => { const input = await instantBody(request, instantClaimInput); return instantResponse({ call: await claimInstantCall(principal.userId, (await params).id, input.lease_token) }) })
}
