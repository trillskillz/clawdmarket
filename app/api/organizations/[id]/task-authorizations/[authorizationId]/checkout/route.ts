import { NextRequest } from 'next/server'
import { organizationTaskBuyerApi } from '@/lib/organization-task-api'
import { purchasingBody, purchasingResult } from '@/lib/organization-purchasing-api'
import { checkoutOrganizationTask, inspectOrganizationTaskCheckout, organizationTaskCheckoutInput } from '@/lib/organization-task-authorizations'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string; authorizationId: string }> }
export async function GET(request: NextRequest, { params }: Context) {
  return organizationTaskBuyerApi(request, false, async buyerId => {
    const { id, authorizationId } = await params
    return purchasingResult(await inspectOrganizationTaskCheckout(id, authorizationId, buyerId))
  })
}
export async function POST(request: NextRequest, { params }: Context) {
  return organizationTaskBuyerApi(request, true, async buyerId => {
    const { id, authorizationId } = await params
    const result = await checkoutOrganizationTask(id, authorizationId, buyerId, await purchasingBody(request, organizationTaskCheckoutInput))
    return purchasingResult(result, result.created ? 201 : 200)
  })
}
