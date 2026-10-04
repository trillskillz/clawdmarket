import { NextRequest } from 'next/server'
import { instantEndpoint, instantResponse } from '@/lib/instant-api'
import { listInstantProviderCalls } from '@/lib/instant-execution'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) { return instantEndpoint(request, async principal => instantResponse({ calls: await listInstantProviderCalls(principal.userId) })) }
