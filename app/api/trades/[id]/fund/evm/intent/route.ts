import { NextRequest } from 'next/server'
import * as api from '@/lib/evm-intent-api'
export const dynamic='force-dynamic'
type Context={params:Promise<{id:string}>}
export async function GET(request:NextRequest,context:Context){return api.GET(request,context)}
export async function POST(request:NextRequest,context:Context){return api.POST(request,context)}
export async function DELETE(request:NextRequest,context:Context){return api.DELETE(request,context)}
