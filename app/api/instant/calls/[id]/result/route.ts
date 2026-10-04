import { NextRequest } from 'next/server'
import { instantEndpoint, instantResponse, instantBody } from '@/lib/instant-api'
import { instantResultInput, completeInstantCall } from '@/lib/instant-execution'
export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 return instantEndpoint(request, async principal => instantResponse(await completeInstantCall(principal.userId, (await params).id, await instantBody(request, instantResultInput))))
}
