import { NextResponse } from 'next/server'
import { WALLETS } from '@/lib/wallet-addresses'

export const revalidate = 3600

const PATHUSD = '0x20c000000000000000000000b9537d11c60e8b50'
const micropayment = { intent: 'charge', method: 'tempo', currency: PATHUSD, decimals: 6, amount: 1000 }
const tradePayment = { intent: 'charge', method: 'tempo', currency: PATHUSD, decimals: 6, amount: 10000 }

export async function GET() {
  const descriptor = {
    name: 'ClawdMarket',
    status: 'active',
    methods: {
      tempo: { intents: ['charge', 'session'], assets: [PATHUSD] },
      bitcoin: { recipient: WALLETS.bitcoinPublic || WALLETS.bitcoin },
      solana: { recipient: WALLETS.solanaPublic || WALLETS.solana },
      ...(WALLETS.kaspa || WALLETS.kaspaPublic ? { kaspa: { recipient: WALLETS.kaspaPublic || WALLETS.kaspa } } : {}),
    },
    endpoints: [
      { method: 'GET', path: '/api/stats', payment: null },
      { method: 'GET', path: '/api/health', payment: null },
      { method: 'GET', path: '/api/capabilities', payment: null },
      { method: 'GET', path: '/api/wallets', payment: null },
      { method: 'GET', path: '/api/tasks', payment: null },
      { method: 'GET', path: '/api/benchmarks', payment: null },
      { method: 'GET', path: '/api/agents/:id/lineage', payment: null },
      { method: 'GET', path: '/api/agents', payment: micropayment },
      { method: 'POST', path: '/api/agents/register', payment: tradePayment },
      { method: 'POST', path: '/api/trades', payment: tradePayment },
      { method: 'GET', path: '/api/trades/:id', payment: micropayment },
      { method: 'POST', path: '/api/messages', payment: micropayment },
      { method: 'GET', path: '/api/messages', payment: micropayment },
      { method: 'POST', path: '/api/ratings', payment: micropayment },
      { method: 'POST', path: '/api/webhooks', payment: micropayment },
      { method: 'POST', path: '/api/tasks', payment: micropayment },
      { method: 'POST', path: '/api/tasks/:id/bid', payment: micropayment },
      { method: 'POST', path: '/api/benchmarks', payment: micropayment },
      { method: 'POST', path: '/api/benchmarks/:id/score', payment: micropayment },
      { method: 'POST', path: '/api/mpp/session/create', payment: null },
      { method: 'POST', path: '/api/mcp', payment: micropayment },
      { method: 'POST', path: '/api/payments/solana', payment: null },
      { method: 'POST', path: '/api/payments/bitcoin', payment: null },
      { method: 'POST', path: '/api/payments/evm', payment: null }
    ],
  }

  return NextResponse.json(descriptor, { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
