import { NextRequest } from 'next/server'
import { purchasingApi, purchasingResult } from '@/lib/organization-purchasing-api'
import { inspectPurchase, stopPurchase } from '@/lib/organization-purchasing'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string; requestId: string }> }
export async function GET(request: NextRequest, { params }: Context) {
  return purchasingApi(request, false, async actor => {
    const { id, requestId } = await params; return purchasingResult(await inspectPurchase(id, requestId, actor))
  })
}
export async function DELETE(request: NextRequest, { params }: Context) {
  return purchasingApi(request, true, async actor => {
    const { id, requestId } = await params; return purchasingResult({ request: await stopPurchase(id, requestId, actor, 'request') })
  })
}
