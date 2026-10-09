import { NextRequest } from 'next/server'
import { purchasingApi,purchasingBody,purchasingResult } from '@/lib/organization-purchasing-api'
import { providerAcceptInput,acceptPrivateProvider } from '@/lib/organization-private-providers'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string;shareId:string}>}) {
  return purchasingApi(request,true,async actor=>{
    const {id,shareId}=await params,result=await acceptPrivateProvider(id,shareId,actor,await purchasingBody(request,providerAcceptInput))
    return purchasingResult(result,result.idempotent?200:201)
  })
}
