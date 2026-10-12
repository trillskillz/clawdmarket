import { NextRequest } from 'next/server'
import { organizationRouteApi } from '@/lib/organization-route-api'
import { purchasingResult } from '@/lib/organization-purchasing-api'
import { inspectOrganizationWorkflow, revokeOrganizationWorkflow } from '@/lib/organization-workflow-authorizations'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string; authorizationId: string }> }
export async function GET(request: NextRequest, { params }: Context) {
  return organizationRouteApi(request, false, async actor => {
    const { id, authorizationId } = await params
    return purchasingResult({ authorization: await inspectOrganizationWorkflow(id, authorizationId, actor) })
  })
}
export async function DELETE(request: NextRequest, { params }: Context) {
  return organizationRouteApi(request, true, async actor => {
    const { id, authorizationId } = await params
    return purchasingResult(await revokeOrganizationWorkflow(id, authorizationId, actor))
  })
}
