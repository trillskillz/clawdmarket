import { NextRequest } from 'next/server'
import { z } from 'zod'
import { purchasingApi, purchasingBody, purchasingResult } from '@/lib/organization-purchasing-api'
import { providerOfferInput, offerPrivateProvider, providerOwnerShares, revokePrivateProvider } from '@/lib/organization-private-providers'
export const dynamic='force-dynamic'
type Context={params:Promise<{id:string}>}
export async function GET(request:NextRequest,{params}:Context) {
  return purchasingApi(request,false,async actor=>purchasingResult({shares:await providerOwnerShares((await params).id,actor)}))
}
export async function POST(request:NextRequest,{params}:Context) {
  return purchasingApi(request,true,async actor=>{
    const result=await offerPrivateProvider((await params).id,actor,await purchasingBody(request,providerOfferInput))
    return purchasingResult(result,result.idempotent?200:201)
  })
}
export async function DELETE(request:NextRequest,{params}:Context) {
  return purchasingApi(request,true,async actor=>{
    const input=await purchasingBody(request,z.object({share_id:z.string().uuid()}).strict())
    return purchasingResult({share:await revokePrivateProvider(input.share_id,actor,undefined,(await params).id)})
  })
}
