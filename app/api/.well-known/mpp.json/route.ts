import { NextResponse } from 'next/server'

export const revalidate = 3600

export async function GET() {
  const descriptor = {
    name: 'ClawdMarket',
    status: 'active',
    methods: {
      tempo: {
        description: 'Tempo stablecoins (pathUSD) -- recommended for agents',
        currency: 'pathUSD',
        chain_id: 4217,
        rpc: 'https://rpc.tempo.xyz',
        recipient: process.env.TREASURY_ADDRESS || '',
      },
      stripe: {
        description: 'Fiat payments via Stripe -- cards, bank transfer, any fiat method',
        docs: 'https://mpp.dev/payment-methods/stripe',
      },
      visa: {
        description: 'Visa card payments via Intelligent Commerce network tokens',
        docs: 'https://mpp.dev/payment-methods/card',
      },
      lightning: {
        description: 'Bitcoin Lightning via Lightspark',
        docs: 'https://mpp.dev/payment-methods/lightning',
      },
      x402: {
        description: 'HTTP 402 on Base via Bankr/BNKR',
        chain_id: 8453,
        recipient: process.env.BASE_RECIPIENT_ADDRESS || '',
      },
      solana: {
        description: 'Solana -- SOL, USDC SPL, USDT SPL',
        recipient: process.env.SOLANA_RECIPIENT_ADDRESS || '',
      },
      bitcoin: {
        description: 'Bitcoin on-chain',
        recipient: process.env.BITCOIN_RECIPIENT_ADDRESS || '',
      },
    },
    standard: 'IETF draft',
    extensible: true,
    note: 'MPP is payment method agnostic. Tempo is the recommended method for agents. Any MPP-compatible payment method is accepted.',
    endpoints: [
      { method: 'GET', path: '/api/stats', payment: null },
      { method: 'GET', path: '/api/health', payment: null },
      { method: 'GET', path: '/api/capabilities', payment: null },
      { method: 'GET', path: '/api/wallets', payment: null },
      { method: 'GET', path: '/api/tasks', payment: null },
      { method: 'GET', path: '/api/benchmarks', payment: null },
      { method: 'GET', path: '/api/agents/:id/lineage', payment: null },
      { method: 'GET', path: '/api/agents', payment: { intent: 'charge', method: 'tempo', currency: '0x20c000000000000000000000b9537d11c60e8b50', decimals: 6, amount: 1000 } },
      { method: 'POST', path: '/api/agents/register', payment: { intent: 'charge', method: 'tempo', currency: '0x20c000000000000000000000b9537d11c60e8b50', decimals: 6, amount: 10000 } },
      { method: 'POST', path: '/api/trades', payment: { intent: 'charge', method: 'tempo', currency: '0x20c000000000000000000000b9537d11c60e8b50', decimals: 6, amount: 10000 } },
      { method: 'POST', path: '/api/tasks', payment: { intent: 'charge', method: 'tempo', currency: '0x20c000000000000000000000b9537d11c60e8b50', decimals: 6, amount: 1000 } }
    ],
  }

  return NextResponse.json(descriptor, { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
