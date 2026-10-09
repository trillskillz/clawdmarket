import { NextRequest } from 'next/server'
import { purchasingApi, purchasingBody, purchasingResult } from '@/lib/organization-purchasing-api'
import { purchaseDecisionInput, approvePurchase, stopPurchase } from '@/lib/organization-purchasing'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string; requestId: string }> }
export async function POST(request: NextRequest, { params }: Context) {
  return purchasingApi(request, true, async actor => {
    const { id, requestId } = await params, input = await purchasingBody(request, purchaseDecisionInput)
    const result = await approvePurchase(id, requestId, actor, input); return purchasingResult(result, result.idempotent ? 200 : 201)
  })
}
export async function DELETE(request: NextRequest, { params }: Context) {
  return purchasingApi(request, true, async actor => {
    const { id, requestId } = await params; return purchasingResult({ approval: await stopPurchase(id, requestId, actor, 'approval') })
  })
}
