import { NextResponse } from 'next/server'
import { getRouteMetrics } from '@/lib/route-metrics'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await getRouteMetrics(), { headers: { 'Cache-Control': 'no-store' } })
}
