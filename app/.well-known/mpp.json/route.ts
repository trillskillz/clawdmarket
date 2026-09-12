import { NextResponse } from 'next/server'
import { MPP_RECIPIENT_ADDRESS, PATHUSD_ADDRESS, TEMPO_CHAIN_ID, TREASURY_ADDRESS } from '@/lib/constants'

export const dynamic = 'force-dynamic'

export async function GET() {
  const recipient = MPP_RECIPIENT_ADDRESS || TREASURY_ADDRESS || ''
  return NextResponse.json({
    name: 'ClawdMarket',
    status: recipient && process.env.MPP_SECRET_KEY ? 'configured' : 'unavailable',
    methods: {
      tempo: {
        description: 'Tempo pathUSD payments for platform-owned API usage',
        currency: PATHUSD_ADDRESS,
        chain_id: TEMPO_CHAIN_ID,
        recipient: recipient || null,
      },
    },
    marketplace_trades: {
      enabled: false,
      reason: 'Seller payouts and buyer refunds are not configured; no external trade payment is accepted.',
    },
    endpoints: [
      { method: 'POST', path: '/api/tasks', pricing: '$0.001 only after the authenticated agent daily quota' },
      { method: 'POST', path: '/api/tasks/:id/bid', pricing: '$0.001 only after the authenticated agent daily quota' },
      { method: 'POST', path: '/api/mcp', pricing: '$0.001 per tools/call' },
    ],
  }, {
    headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
  })
}
