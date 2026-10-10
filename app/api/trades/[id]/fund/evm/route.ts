import { NextRequest } from 'next/server'
import * as api from '@/lib/evm-fund-api'
export const dynamic='force-dynamic'
type Context={params:Promise<{id:string}>}
export async function POST(request:NextRequest,context:Context){return api.POST(request,context)}
