import { NextRequest,NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { authorizeAdmin } from '@/lib/admin-auth'
import { inspectReputationHealth } from '@/lib/reputation-health'
export const dynamic='force-dynamic'
export async function GET(req:NextRequest){
 const token=req.headers.get('authorization')??(req.cookies.get('auth-token')?.value?`Bearer ${req.cookies.get('auth-token')!.value}`:null)
 const auth=await authenticateRequest(token),denied=authorizeAdmin(auth?{userId:auth.userId,email:auth.email}:null)
 const headers={'Cache-Control':'private, no-store',Vary:'Authorization, Cookie'}
 if(denied){Object.entries(headers).forEach(([k,v])=>denied.headers.set(k,v));return denied}
 try{const report=await inspectReputationHealth();return NextResponse.json(report,{status:report.healthy?200:503,headers})}
 catch{return NextResponse.json({healthy:false,error_code:'REPUTATION_MONITOR_UNAVAILABLE',projection_status:'unavailable'},{status:503,headers})}
}
