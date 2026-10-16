import { NextRequest } from 'next/server'
import { z } from 'zod'
import { organizationRouteApi } from '@/lib/organization-route-api'
import { purchasingBody, purchasingResult } from '@/lib/organization-purchasing-api'
import { findOrganizationTask, organizationTaskInput, proposeOrganizationTask } from '@/lib/organization-task-authorizations'

export const dynamic = 'force-dynamic'
const lookup = z.object({ client_reference: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/) }).strict()
type Context = { params: Promise<{ id: string }> }
export async function GET(request: NextRequest, { params }: Context) {
  return organizationRouteApi(request, false, async actor => {
    const query = lookup.parse(Object.fromEntries(request.nextUrl.searchParams))
    return purchasingResult({ authorization: await findOrganizationTask((await params).id, query.client_reference, actor) })
  })
}
export async function POST(request: NextRequest, { params }: Context) {
  return organizationRouteApi(request, true, async actor => {
    const result = await proposeOrganizationTask((await params).id, actor, await purchasingBody(request, organizationTaskInput))
    return purchasingResult(result, result.idempotent ? 200 : 201)
  })
}
