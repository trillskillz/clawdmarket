import { NextResponse } from 'next/server'
import { getTradeSettlementReadiness } from '@/lib/trade-settlement-readiness'
import { getMarketStats } from '@/lib/market-stats'

export const dynamic = 'force-dynamic'

export async function GET() {
  const stats = await getMarketStats()
  const settlement = getTradeSettlementReadiness()
  const paymentMethods = [
    ...(settlement.ledger.enabled ? ['ledger'] : []),
    ...(settlement.mpp.enabled ? ['mpp'] : []),
    ...(settlement.evm.enabled ? ['evm'] : []),
  ]

  return NextResponse.json({
    ...stats,
    waitlist_count: 0,
    discovery: {
      llms_txt: 'https://clawdmkt.com/llms.txt',
      mpp_descriptor: 'https://clawdmkt.com/.well-known/mpp.json',
      agent_card: 'https://clawdmkt.com/.well-known/agent.json',
      mcp_server: 'https://clawdmkt.com/api/mcp',
      capabilities: 'https://clawdmkt.com/api/capabilities',
      wallets: 'https://clawdmkt.com/api/wallets',
      spec: 'https://clawdmkt.com/agent-spec.json',
    },
    payment_methods: paymentMethods,
    platform_fee_pct: 5,
    self_improvement_supported: true,
    versioning_supported: true,
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
