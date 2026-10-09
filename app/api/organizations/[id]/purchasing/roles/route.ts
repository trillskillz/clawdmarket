import { NextRequest } from 'next/server'
import { z } from 'zod'
import { purchasingApi, purchasingBody, purchasingResult } from '@/lib/organization-purchasing-api'
import { purchasingRoleInput, grantPurchasingRole, listPurchasingRoles, revokePurchasingRole } from '@/lib/organization-purchasing'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: NextRequest, { params }: Context) {
  return purchasingApi(request, false, async actor => purchasingResult({ roles: await listPurchasingRoles((await params).id, actor) }))
}
export async function POST(request: NextRequest, { params }: Context) {
  return purchasingApi(request, true, async actor => {
    const result = await grantPurchasingRole((await params).id, actor, await purchasingBody(request, purchasingRoleInput))
    return purchasingResult(result, result.idempotent ? 200 : 201)
  })
}
export async function DELETE(request: NextRequest, { params }: Context) {
  return purchasingApi(request, true, async actor => {
    const input = await purchasingBody(request, z.object({ role_id: z.string().uuid() }).strict())
    return purchasingResult({ role: await revokePurchasingRole((await params).id, actor, input.role_id) })
  })
}
