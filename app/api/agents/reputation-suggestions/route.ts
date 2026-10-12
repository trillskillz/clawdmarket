import { NextRequest,NextResponse } from 'next/server'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { planRoute,routePlanInput } from '@/lib/route-planning'
import { readBoundedJson } from '@/lib/private-artifacts'
import { z } from 'zod'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store',Vary:'Authorization, Cookie'}
const response=(body:unknown,status=200)=>NextResponse.json(body,{status,headers})
/** Read-only suggestions pass the canonical buyer, funding and provider gates first. */
export async function POST(req:NextRequest){
 const principal=await resolveRequestPrincipal(req)
 if(!principal)return response({error:'Unauthorized'},401)
 try{
  const raw=await readBoundedJson(req,32768)
  const input=routePlanInput.parse(raw),planned=await planRoute(input,principal.userId)
  return response({persisted:false,funds_moved:false,execution_authority:false,reputation_shadow:planned.reputation_shadow??null,reputation_ranking:planned.reputation_ranking??null,
   candidates:planned.candidates,examined:planned.examined,truncated:planned.truncated,comparison_scope:'bounded_current_eligible_candidates; not_global_best'})
 }catch(error){if(error instanceof z.ZodError)return response({error_code:'INVALID_SUGGESTION_QUERY'},400);return response({error_code:'REPUTATION_SUGGESTIONS_UNAVAILABLE'},503)}
}
