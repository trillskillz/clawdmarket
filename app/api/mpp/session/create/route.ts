import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(_request: NextRequest) {
  return NextResponse.json({
    info: 'MPP sessions are managed client-side via mppx',
    docs: 'https://mpp.dev/payment-methods/tempo/session',
    example: {
      open: 'tempo.session({ account, maxDeposit: "1" })',
      pay: 'session.fetch("https://clawdmkt.com/api/...")',
      close: 'session.close()',
    },
    recipient: '0x3E911a2EaFbE60ca538F659836d6DE60Db639D44',
    chain_id: 4217,
    network: 'tempo-mainnet',
  })
}
