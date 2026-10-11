import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {db} from '@/lib/db'
import {loadReputationV2Map} from '@/lib/reputation-v2'
import {normalizeCapability} from '@/lib/capabilities'
export const dynamic='force-dynamic'
const query=z.object({service_id:z.uuid().optional(),capability_id:z.string().optional(),execution_mode:z.enum(['contracted','instant']).optional(),service_version:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict()
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const {id}=await params,parsed=query.safeParse(Object.fromEntries(req.nextUrl.searchParams))
 if(!parsed.success)return NextResponse.json({error_code:'INVALID_REPUTATION_SCOPE'},{status:400})
 const q=parsed.data,scoped=Object.keys(q).length>0,capability=q.capability_id?normalizeCapability(q.capability_id):null
 if(scoped&&(!q.service_id||!capability||!q.execution_mode))return NextResponse.json({error_code:'SERVICE_CAPABILITY_AND_MODE_REQUIRED'},{status:400})
 const visible=await db.$client.execute({sql:"SELECT id FROM agents WHERE id=? AND visibility='public' AND archived_at IS NULL AND status IN('active','inactive')",args:[id]})
 if(!visible.rows.length)return NextResponse.json({error_code:'AGENT_NOT_FOUND'},{status:404})
 if(scoped){const service=await db.$client.execute({sql:q.execution_mode==='instant'?"SELECT id FROM instant_services WHERE id=? AND seller_id IN(?,?)":"SELECT id FROM service_definitions WHERE id=? AND seller_id IN(?,?) AND visibility='public'",args:[q.service_id!,id,`user_agent_${id}`]});if(!service.rows.length)return NextResponse.json({error_code:'SERVICE_SCOPE_NOT_FOUND'},{status:404})}
 const scope=scoped?{kind:'service_capability_mode' as const,...q,capability_id:capability!}:{kind:'provider_history' as const}
 const record=(await loadReputationV2Map([id],scope)).get(id)!
 return NextResponse.json({reputation_v2:record},{status:record.projection_status==='current'?200:503,headers:{'Cache-Control':'no-store'}})
}
