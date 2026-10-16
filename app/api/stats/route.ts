import { NextResponse } from 'next/server'
import { getTradeSettlementReadiness } from '@/lib/trade-settlement-readiness'
import { getMarketStats } from '@/lib/market-stats'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
  const stats = await getMarketStats()
  const settlement = getTradeSettlementReadiness()
  const paymentMethods = [
    ...(settlement.credit.enabled ? ['credit'] : []),
    ...(settlement.ledger.enabled ? ['ledger'] : []),
    ...(settlement.mpp.enabled ? ['mpp'] : []),
    ...(settlement.evm.enabled ? ['evm'] : []),
  ]

  return NextResponse.json({
    ...stats,
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
    self_improvement_supported: false,
    versioning_supported: false,
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
  } catch {
    return NextResponse.json({ data_status: 'unavailable', observed_at: null, requested_at: new Date().toISOString(), error: 'market_statistics_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '15' } })
  }
}
