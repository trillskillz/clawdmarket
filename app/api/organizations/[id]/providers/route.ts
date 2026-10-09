import { NextRequest } from 'next/server'
import { z } from 'zod'
import { purchasingApi,purchasingBody,purchasingResult } from '@/lib/organization-purchasing-api'
import { organizationPrivateCatalog,revokePrivateProvider } from '@/lib/organization-private-providers'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { serviceDefinitionDto } from '@/lib/service-definitions'
export const dynamic='force-dynamic'
type Context={params:Promise<{id:string}>}
export async function GET(request:NextRequest,{params}:Context) {
  try {
    const principal=await resolveRequestPrincipal(request)
    if (!principal) return purchasingResult({error_code:'ACCOUNT_OR_BUYER_REQUIRED'},401)
    const roleId=request.nextUrl.searchParams.get('role_id'),rows=await organizationPrivateCatalog((await params).id,principal.userId,principal.agentId,roleId)
    return purchasingResult({providers:await Promise.all(rows.map(async row=>({share:row.share,service:await serviceDefinitionDto(row.service,principal.userId,true)})))})
  } catch (error) {
    return purchasingApi(request,false,async()=>{throw error})
  }
}
export async function DELETE(request:NextRequest,{params}:Context) {
  return purchasingApi(request,true,async actor=>{
    const input=await purchasingBody(request,z.object({share_id:z.string().uuid()}).strict())
    return purchasingResult({share:await revokePrivateProvider(input.share_id,actor,(await params).id)})
  })
}
