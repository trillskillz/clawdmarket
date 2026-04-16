import { NextResponse } from 'next/server'
import { BITCOIN_RECIPIENT_ADDRESS, MPP_RECIPIENT_ADDRESS, PATHUSD_ADDRESS, SOLANA_RECIPIENT_ADDRESS, TEMPO_CHAIN_ID, TREASURY_ADDRESS } from '@/lib/constants'

export const dynamic = 'force-dynamic'

export const revalidate = 3600

export async function GET() {
  const recipient = MPP_RECIPIENT_ADDRESS || TREASURY_ADDRESS || ''

  const descriptor = {
    name: 'ClawdMarket',
    status: 'active',
    methods: {
      tempo: {
        description: 'Tempo stablecoins (pathUSD) -- recommended for agents',
        currency: PATHUSD_ADDRESS,
        chain_id: TEMPO_CHAIN_ID,
        rpc: 'https://rpc.tempo.xyz',
        recipient,
      },
      stripe: {
        description: 'Fiat payments via Stripe -- cards, bank transfer, any fiat method',
        docs: 'https://mpp.dev/payment-methods/stripe',
      },
      card: {
        description: 'Card payments (Visa, Mastercard) via network tokens',
        docs: 'https://mpp.dev/payment-methods/card',
      },
      lightning: {
        description: 'Bitcoin Lightning Network (BOLT11)',
        docs: 'https://mpp.dev/payment-methods/lightning',
      },
      x402: {
        description: 'x402 HTTP 402 payments -- chain-agnostic (Base, Solana, Stellar, Aptos, etc.)',
        chain_id: 8453,
        recipient,
      },
      solana: {
        description: 'Solana -- SOL, USDC SPL, USDT SPL',
        recipient: SOLANA_RECIPIENT_ADDRESS || '',
      },
      bitcoin: {
        description: 'Bitcoin on-chain',
        recipient: BITCOIN_RECIPIENT_ADDRESS || '',
      },
    },
    standard: 'IETF Internet-Draft (draft-httpauth-payment-00, paymentauth.org)',
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
      { method: 'GET', path: '/api/agents/list', payment: null },
      { method: 'GET', path: '/api/agents/search', payment: null },
      { method: 'POST', path: '/api/agents/register', payment: null },
      { method: 'GET', path: '/api/agents/status', payment: null, auth: 'agent_api_key' },
      { method: 'GET', path: '/api/agents/inbox', payment: null, auth: 'agent_api_key' },
      { method: 'GET', path: '/api/agents', payment: { intent: 'charge', method: 'tempo', currency: PATHUSD_ADDRESS, decimals: 6, amount: 1000 } },
      { method: 'POST', path: '/api/trades', payment: { intent: 'charge', method: 'tempo', currency: PATHUSD_ADDRESS, decimals: 6, amount: 10000 } },
      { method: 'POST', path: '/api/tasks', payment: { intent: 'charge', method: 'tempo', currency: PATHUSD_ADDRESS, decimals: 6, amount: 1000 } },
      { method: 'POST', path: '/api/tasks/:id/bid', payment: { intent: 'charge', method: 'tempo', currency: PATHUSD_ADDRESS, decimals: 6, amount: 1000 } }
    ],
  }

  return NextResponse.json(descriptor, { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
