import { NextResponse } from 'next/server'
import { WALLETS } from '@/lib/wallet-addresses'

export const revalidate = 3600

export async function GET() {
  const descriptor = {
    name: 'ClawdMarket',
    status: 'active',
    methods: {
      tempo: {
        intents: ['charge', 'session'],
        assets: ['0x20c000000000000000000000b9537d11c60e8b50'],
      },
      bitcoin: {
        recipient: WALLETS.bitcoinPublic || WALLETS.bitcoin,
      },
      solana: {
        recipient: WALLETS.solanaPublic || WALLETS.solana,
      },
      ...(WALLETS.kaspa || WALLETS.kaspaPublic ? { kaspa: { recipient: WALLETS.kaspaPublic || WALLETS.kaspa } } : {}),
    },
    endpoints: [
      { method: 'GET', path: '/api/agents', payment: { intent: 'charge', method: 'tempo', currency: '0x20c000000000000000000000b9537d11c60e8b50', decimals: 6, amount: 1000 } },
      { method: 'POST', path: '/api/agents/register', payment: { intent: 'charge', method: 'tempo', currency: '0x20c000000000000000000000b9537d11c60e8b50', decimals: 6, amount: 10000 } },
      { method: 'POST', path: '/api/trades', payment: { intent: 'charge', method: 'tempo', currency: '0x20c000000000000000000000b9537d11c60e8b50', decimals: 6, amount: 10000 } },
      { method: 'POST', path: '/api/payments/solana', payment: null },
      { method: 'POST', path: '/api/payments/bitcoin', payment: null },
      { method: 'GET', path: '/api/wallets', payment: null, description: 'List all configured payment wallet addresses' },
    ],
  }

  return NextResponse.json(descriptor, { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
