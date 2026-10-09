import { NextRequest } from 'next/server'
import { z } from 'zod'
import { purchasingApi,purchasingBody,purchasingResult } from '@/lib/organization-purchasing-api'
import { createSpendingAccount,inspectSpendingAccounts,revokeSpendingAccount,spendingAccountInput } from '@/lib/organization-spending-accounts'
export const dynamic='force-dynamic'
type Context={params:Promise<{id:string}>}
export async function GET(request:NextRequest,{params}:Context){return purchasingApi(request,false,async actor=>purchasingResult({spending_accounts:await inspectSpendingAccounts((await params).id,actor)}))}
export async function POST(request:NextRequest,{params}:Context){return purchasingApi(request,true,async actor=>{
  const result=await createSpendingAccount((await params).id,actor,await purchasingBody(request,spendingAccountInput))
  return purchasingResult(result,result.idempotent?200:201)
})}
export async function DELETE(request:NextRequest,{params}:Context){return purchasingApi(request,true,async actor=>{
  const input=await purchasingBody(request,z.object({account_id:z.string().uuid()}).strict())
  return purchasingResult({account:await revokeSpendingAccount((await params).id,input.account_id,actor)})
})}
