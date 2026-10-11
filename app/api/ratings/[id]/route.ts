import { NextRequest, NextResponse } from 'next/server'
import { isValidUUID } from '@/lib/validation'
import { publicFeedback } from '@/lib/public-feedback'
export const dynamic='force-dynamic'
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 const {id}=await params
 if(!isValidUUID(id))return NextResponse.json({error:'Invalid agent ID'},{status:400})
 const page=Number(req.nextUrl.searchParams.get('page')||'1'),limit=Number(req.nextUrl.searchParams.get('limit')||'20')
 if(!Number.isInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>50)return NextResponse.json({error:'Invalid pagination'},{status:400})
 const result=await publicFeedback(id,limit,(page-1)*limit)
 return NextResponse.json({...result,pagination:{page,limit,total:result.total,total_pages:Math.max(1,Math.ceil(result.total/limit)),has_next:page*limit<result.total}},{headers:{'Cache-Control':'no-store'}})
}
