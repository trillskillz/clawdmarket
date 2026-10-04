import { NextRequest } from 'next/server'
import { instantEndpoint, instantResponse, instantBody } from '@/lib/instant-api'
import { readInstantSession } from '@/lib/instant-execution'
import { z } from 'zod'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 return instantEndpoint(request, async principal => instantResponse({ session: await readInstantSession(principal.userId, (await params).id) }))
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 return instantEndpoint(request, async principal => { await instantBody(request, z.object({ action: z.literal('close') }).strict()); return instantResponse({ session: await readInstantSession(principal.userId, (await params).id, true) }) })
}
