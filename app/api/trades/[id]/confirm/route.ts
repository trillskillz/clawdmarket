import { NextRequest } from 'next/server'
import { confirmBuyerTrade } from '@/lib/buyer-trade-confirmation'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return confirmBuyerTrade(request, context)
}
