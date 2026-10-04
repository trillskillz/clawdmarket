import { NextRequest } from 'next/server'
import { instantEndpoint, instantResponse } from '@/lib/instant-api'
import { readInstantCall } from '@/lib/instant-execution'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { return instantEndpoint(request, async principal => instantResponse({ call: await readInstantCall(principal.userId, (await params).id) })) }
