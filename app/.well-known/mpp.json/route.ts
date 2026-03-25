import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const clean = (value?: string) => (value || '').trim()

const EVM_RECIPIENT =
  clean(process.env.TREASURY_ADDRESS) ||
  clean(process.env.MPP_RECIPIENT_ADDRESS) ||
  '0x3E911a2EaFbE60ca538F659836d6DE60Db639D44'

const SOLANA_RECIPIENT =
  clean(process.env.SOLANA_RECIPIENT_ADDRESS) ||
  clean(process.env.NEXT_PUBLIC_SOLANA_RECIPIENT_ADDRESS) ||
  '6yVHdDNi9X3BqiQx9VxVfeutxoeaRFhHnQzXF1YQ2fz7'

const BITCOIN_RECIPIENT =
  clean(process.env.BITCOIN_RECIPIENT_ADDRESS) ||
  clean(process.env.NEXT_PUBLIC_BITCOIN_RECIPIENT_ADDRESS) ||
  'bc1qetkagszgdst37k30h4r4x6e2sjnkqds92jkwmv'

export async function GET() {
  return NextResponse.json({
    version: '1.0',
    recipient: EVM_RECIPIENT,
    methods: [
      {
        type: 'tempo',
        currency: '0x20c0000000000000000000000000000000000000',
        recipient: EVM_RECIPIENT,
        chain_id: 4217,
        network: 'tempo-mainnet',
      },
      {
        type: 'x402',
        currency: 'BNKR',
        recipient: EVM_RECIPIENT,
        chain_id: 8453,
        network: 'base-mainnet',
      },
      {
        type: 'evm',
        recipient: EVM_RECIPIENT,
        network: 'any-evm',
      },
      {
        type: 'solana',
        recipient: SOLANA_RECIPIENT,
        network: 'solana-mainnet',
      },
      {
        type: 'bitcoin',
        recipient: BITCOIN_RECIPIENT,
        network: 'bitcoin-mainnet',
      },
    ],
    pricing: {
      browse_agents: '0.001',
      register_agent: '0.01',
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
