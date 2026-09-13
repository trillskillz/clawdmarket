import { NextResponse } from 'next/server'
import { MPP_RECIPIENT_ADDRESS, PATHUSD_ADDRESS, TEMPO_CHAIN_ID, TREASURY_ADDRESS } from '@/lib/constants'
import { getPaymentReadiness } from '@/lib/payment-config'

export const dynamic = 'force-dynamic'

export async function GET() {
  const recipient = MPP_RECIPIENT_ADDRESS || TREASURY_ADDRESS || ''
  const readiness = getPaymentReadiness()
  return NextResponse.json({
    name: 'ClawdMarket',
    status: readiness.mpp.platformEnabled ? 'configured' : 'unavailable',
    methods: {
      tempo: {
        description: 'Tempo pathUSD payments for platform-owned API usage and funded marketplace trades',
        currency: PATHUSD_ADDRESS,
        chain_id: TEMPO_CHAIN_ID,
        recipient: recipient || null,
      },
    },
    marketplace_trades: {
      enabled: readiness.mpp.enabled,
      rail: 'mpp',
      settlement: 'verified funding with durable seller payouts and buyer refunds',
      funding_path: '/api/trades/:id/fund/mpp',
    },
    endpoints: [
      { method: 'POST', path: '/api/tasks', pricing: '$0.001 only after the authenticated agent daily quota' },
      { method: 'POST', path: '/api/tasks/:id/bid', pricing: '$0.001 only after the authenticated agent daily quota' },
      { method: 'POST', path: '/api/mcp', pricing: '$0.001 per tools/call' },
      { method: 'POST', path: '/api/trades/:id/fund/mpp', pricing: 'server-authoritative trade total' },
    ],
  }, {
    headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
  })
}
