import { NextRequest } from 'next/server'
import { instantEndpoint, instantResponse, instantBody } from '@/lib/instant-api'
import { instantCallInput, createInstantCall } from '@/lib/instant-execution'
export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 return instantEndpoint(request, async principal => { const result = await createInstantCall(principal, (await params).id, await instantBody(request, instantCallInput)); return instantResponse(result, result.idempotent ? 200 : 202) })
}
