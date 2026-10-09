import { NextRequest } from 'next/server'
import { purchasingApi, purchasingBody, purchasingResult } from '@/lib/organization-purchasing-api'
import { purchaseRequestInput, createPurchaseRequest } from '@/lib/organization-purchasing'
import { listPurchaseHistory, purchaseHistoryQuery } from '@/lib/organization-purchase-history'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return purchasingApi(request, false, async actor => purchasingResult(await listPurchaseHistory((await params).id, actor,
    purchaseHistoryQuery.parse(Object.fromEntries(request.nextUrl.searchParams)))))
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return purchasingApi(request, true, async actor => {
    const result = await createPurchaseRequest((await params).id, actor, await purchasingBody(request, purchaseRequestInput))
    return purchasingResult(result, result.idempotent ? 200 : 201)
  })
}
