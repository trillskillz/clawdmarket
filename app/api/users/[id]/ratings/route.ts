import {NextRequest,NextResponse} from 'next/server'
import {publicFeedback} from '@/lib/public-feedback'
export const dynamic='force-dynamic'
export async function GET(_req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 const {id}=await params
 return NextResponse.json(await publicFeedback(id,50),{headers:{'Cache-Control':'no-store'}})
}
