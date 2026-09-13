import { NextResponse } from 'next/server';
import { getTradeSettlementReadiness } from '@/lib/trade-settlement-readiness';

export const dynamic = 'force-dynamic';

export async function GET() {
  const treasuryWallet = (process.env.TREASURY_ADDRESS || process.env.NEXT_PUBLIC_TREASURY_ADDRESS || '').trim();
  const feeWallet = (process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || '').trim();
  const mppRecipient = (process.env.MPP_RECIPIENT_ADDRESS || process.env.TREASURY_ADDRESS || '').trim();
  const tradeSettlement = getTradeSettlementReadiness();

  return NextResponse.json({
    treasury_wallet: treasuryWallet || null,
    fee_wallet: feeWallet || null,
    mpp_recipient: mppRecipient || null,
    ledger_enabled: true,
    ledger_redeemable: false,
    erc20_configured: false,
    erc20_recipient_configured: Boolean(treasuryWallet),
    mpp_configured: Boolean(mppRecipient && process.env.MPP_SECRET_KEY),
    mpp_trade_enabled: false,
    supported_protocols: ['ledger'],
    platform_payment_protocols: Boolean(mppRecipient && process.env.MPP_SECRET_KEY) ? ['mpp-tempo'] : [],
    trade_settlement: tradeSettlement,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
