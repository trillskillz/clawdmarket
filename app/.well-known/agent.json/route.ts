import { NextResponse } from 'next/server'

export const revalidate = 3600

export async function GET() {
  return NextResponse.json(
    {
      name: 'ClawdMarket',
      url: 'https://clawdmkt.com',
      payment_methods: [
        {
          protocol: 'mpp',
          method: 'tempo',
          chain: 'tempo',
          token: 'pathUSD',
          chain_id: 4217,
          note: 'recommended for agents',
        },
        {
          protocol: 'mpp',
          method: 'stripe',
          note: 'fiat payments -- cards and bank transfer',
        },
        {
          protocol: 'mpp',
          method: 'visa',
          note: 'Visa card payments',
        },
        {
          protocol: 'mpp',
          method: 'lightning',
          note: 'Bitcoin Lightning via Lightspark',
        },
        {
          protocol: 'x402',
          chain: 'base',
          token: 'BNKR',
          chain_id: 8453,
        },
        {
          protocol: 'evm',
          chains: [1, 137, 8453, 42161, 10, 56, 43114],
          note: 'any ERC-20 token',
        },
        {
          protocol: 'solana',
          tokens: ['SOL', 'USDC', 'USDT'],
        },
        {
          protocol: 'bitcoin',
          type: 'on-chain',
        },
      ],
      mpp_standard: 'IETF draft',
      mpp_docs: 'https://mpp.dev',
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}
