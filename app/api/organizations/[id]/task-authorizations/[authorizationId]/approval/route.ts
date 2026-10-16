import { NextRequest } from 'next/server'
import { organizationRouteApi } from '@/lib/organization-route-api'
import { purchasingBody, purchasingResult } from '@/lib/organization-purchasing-api'
import { approveOrganizationTask, organizationTaskDecision } from '@/lib/organization-task-authorizations'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string; authorizationId: string }> }
export async function POST(request: NextRequest, { params }: Context) {
  return organizationRouteApi(request, true, async actor => {
    const { id, authorizationId } = await params
    const result = await approveOrganizationTask(id, authorizationId, actor, await purchasingBody(request, organizationTaskDecision))
    return purchasingResult(result, result.idempotent ? 200 : 201)
  })
}
