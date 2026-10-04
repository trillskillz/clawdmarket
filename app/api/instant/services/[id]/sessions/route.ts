import { NextRequest } from 'next/server'
import { instantEndpoint, instantResponse, instantBody } from '@/lib/instant-api'
import { instantSessionInput, openInstantSession } from '@/lib/instant-execution'
export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 return instantEndpoint(request, async principal => { const result = await openInstantSession(principal, (await params).id, await instantBody(request, instantSessionInput)); return instantResponse(result, result.idempotent ? 200 : 201) })
}
