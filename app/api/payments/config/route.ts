import { NextResponse } from 'next/server';
import { getTradeSettlementReadiness } from '@/lib/trade-settlement-readiness';
import { getNewPaymentControl, NEW_PAYMENTS_PAUSED_MESSAGE } from '@/lib/payment-control';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tradeSettlement = getTradeSettlementReadiness();
  let control;
  try { control = await getNewPaymentControl(); }
  catch { return NextResponse.json({ error: 'Payment availability could not be checked' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  const accepting = !control.paused;
  const supported = [
    ...(accepting && tradeSettlement.ledger.enabled ? ['ledger'] : []),
    ...(accepting && tradeSettlement.mpp.enabled ? ['mpp-tempo'] : []),
    ...(accepting && tradeSettlement.evm.enabled ? ['erc20-evm'] : []),
  ];

  return NextResponse.json({
    mode: 'production',
    new_payments_paused: control.paused,
    payment_pause_reason: control.paused ? NEW_PAYMENTS_PAUSED_MESSAGE : null,
    treasury_wallet: tradeSettlement.evm.treasury,
    mpp_recipient: tradeSettlement.mpp.recipient,
    ledger_enabled: accepting && tradeSettlement.ledger.enabled,
    ledger_redeemable: tradeSettlement.ledger.redeemable,
    erc20_configured: accepting && tradeSettlement.evm.enabled,
    mpp_configured: accepting && tradeSettlement.mpp.enabled,
    mpp_trade_enabled: accepting && tradeSettlement.mpp.enabled,
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
  }, { headers: { 'Cache-Control': 'no-store' } });
}
