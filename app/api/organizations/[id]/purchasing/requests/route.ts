import { NextRequest } from 'next/server'
import { purchasingApi, purchasingBody, purchasingResult } from '@/lib/organization-purchasing-api'
import { purchaseRequestInput, createPurchaseRequest } from '@/lib/organization-purchasing'
export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return purchasingApi(request, true, async actor => {
    const result = await createPurchaseRequest((await params).id, actor, await purchasingBody(request, purchaseRequestInput))
    return purchasingResult(result, result.idempotent ? 200 : 201)
  })
}
