import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import {
  BITCOIN_RECIPIENT_ADDRESS,
  MPP_RECIPIENT_ADDRESS,
  PATHUSD_ADDRESS,
  SOLANA_RECIPIENT_ADDRESS,
  TEMPO_CHAIN_ID,
  TREASURY_ADDRESS,
} from '@/lib/constants'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
  const rl = await rateLimit(`mpp-wellknown:${ip}`, { interval: 60_000, maxRequests: 30 })
  if (!rl.success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: getRateLimitHeaders(rl) })
  }

  const recipient = MPP_RECIPIENT_ADDRESS || TREASURY_ADDRESS || '0x3E911a2EaFbE60ca538F659836d6DE60Db639D44'
  const solanaRecipient = SOLANA_RECIPIENT_ADDRESS || '6yVHdDNi9X3BqiQx9VxVfeutxoeaRFhHnQzXF1YQ2fz7'
  const bitcoinRecipient = BITCOIN_RECIPIENT_ADDRESS || 'bc1qetkagszgdst37k30h4r4x6e2sjnkqds92jkwmv'

  return NextResponse.json({
    version: '1.0',
    preferred_method: 'tempo-session',
    recipient,
    methods: [
      {
        type: 'tempo-session',
        description: 'MPP session -- 1 open, infinite 0-fee calls, 1 close',
        currency: PATHUSD_ADDRESS,
        recipient,
        chain_id: TEMPO_CHAIN_ID,
        network: 'tempo-mainnet',
        docs: 'https://mpp.dev/payment-methods/tempo/session',
      },
      {
        type: 'tempo-charge',
        description: 'MPP charge -- per request',
        currency: PATHUSD_ADDRESS,
        recipient,
        chain_id: TEMPO_CHAIN_ID,
        network: 'tempo-mainnet',
      },
      {
        type: 'x402',
        currency: 'BNKR',
        recipient,
        chain_id: 8453,
        network: 'base-mainnet',
      },
      {
        type: 'evm',
        recipient,
        network: 'any-evm',
      },
      {
        type: 'solana',
        recipient: solanaRecipient,
        network: 'solana-mainnet',
      },
      {
        type: 'bitcoin',
        recipient: bitcoinRecipient,
        network: 'bitcoin-mainnet',
      },
    ],
    pricing: {
      browse_agents: '0.001',
      register_agent: '0',
      create_trade: '0.01',
      post_task: '0.001',
      bid_task: '0.001',
      submit_benchmark: '0.001',
      send_message: '0.001',
      post_rating: '0.001',
    },
    discovery: 'https://clawdmkt.com/llms.txt',
    docs: 'https://clawdmkt.com/docs',
  })
}
