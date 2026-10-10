import { NextRequest } from 'next/server'
import * as api from '@/lib/mpp-fund-api'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}){return api.POST(request,context)}
