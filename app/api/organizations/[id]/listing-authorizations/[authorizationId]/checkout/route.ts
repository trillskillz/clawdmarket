import { NextRequest } from 'next/server'
import { organizationListingBuyerApi } from '@/lib/organization-listing-api'
import { purchasingBody, purchasingResult } from '@/lib/organization-purchasing-api'
import { checkoutOrganizationListing, inspectOrganizationListingCheckout } from '@/lib/organization-listing-checkout'
import { organizationListingCheckoutInput } from '@/lib/organization-listing-authorizations'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string; authorizationId: string }> }
export async function GET(request: NextRequest, { params }: Context) {
  return organizationListingBuyerApi(request, false, async buyerId => {
    const { id, authorizationId } = await params
    return purchasingResult(await inspectOrganizationListingCheckout(id, authorizationId, buyerId))
  })
}
export async function POST(request: NextRequest, { params }: Context) {
  return organizationListingBuyerApi(request, true, async buyerId => {
    const { id, authorizationId } = await params
    const result = await checkoutOrganizationListing(id, authorizationId, buyerId, await purchasingBody(request, organizationListingCheckoutInput))
    return purchasingResult(result, result.created ? 201 : 200)
  })
}
