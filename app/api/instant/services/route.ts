import { NextRequest } from 'next/server'
import { instantEndpoint, instantResponse, instantBody } from '@/lib/instant-api'
import { instantServiceInput, createInstantService, instantServiceDto } from '@/lib/instant-execution'
import { db } from '@/lib/db'
import { instant_services } from '@/lib/schema'
import { and, eq, sql } from 'drizzle-orm'
export const dynamic = 'force-dynamic'
export async function GET() {
 const services = await db.select().from(instant_services).where(and(eq(instant_services.status, 'active'), sql`(${instant_services.seller_id} NOT GLOB 'user_agent_*' OR EXISTS (SELECT 1 FROM agents a WHERE 'user_agent_' || a.id = ${instant_services.seller_id} AND a.status = 'active' AND a.visibility = 'public' AND a.archived_at IS NULL))`)).limit(100)
 return instantResponse({ services: services.map(instantServiceDto) })
}
export async function POST(request: NextRequest) {
 return instantEndpoint(request, async principal => instantResponse({ service: await createInstantService(principal, await instantBody(request, instantServiceInput)) }, 201))
}
