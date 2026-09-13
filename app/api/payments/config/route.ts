import { NextResponse } from 'next/server';
import { getTradeSettlementReadiness } from '@/lib/trade-settlement-readiness';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tradeSettlement = getTradeSettlementReadiness();
  const supported = [
    ...(tradeSettlement.ledger.enabled ? ['ledger'] : []),
    ...(tradeSettlement.mpp.enabled ? ['mpp-tempo'] : []),
    ...(tradeSettlement.evm.enabled ? ['erc20-evm'] : []),
  ];

  return NextResponse.json({
    mode: 'production',
    treasury_wallet: tradeSettlement.evm.treasury,
    mpp_recipient: tradeSettlement.mpp.recipient,
    ledger_enabled: tradeSettlement.ledger.enabled,
    ledger_redeemable: tradeSettlement.ledger.redeemable,
    erc20_configured: tradeSettlement.evm.enabled,
    mpp_configured: tradeSettlement.mpp.enabled,
    mpp_trade_enabled: tradeSettlement.mpp.enabled,
    supported_protocols: supported,
    platform_payment_protocols: tradeSettlement.mpp.platformEnabled ? ['mpp-tempo'] : [],
    accepted_tokens: tradeSettlement.evm.tokens.map(({ chainId, chainName, address, symbol, decimals, confirmations, fixedUsdPrice }) => ({
      chain_id: chainId,
      chain_name: chainName,
      token_address: address,
      symbol,
      decimals,
      confirmations,
      fixed_usd_price: fixedUsdPrice,
    })),
    trade_settlement: tradeSettlement,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
