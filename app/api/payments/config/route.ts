import { NextResponse } from 'next/server';

const DEFAULT_ESCROW = '0x3E911a2EaFbE60ca538F659836d6DE60Db639D44';
const DEFAULT_FEE = '';
const DEFAULT_TOKEN = '0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b';

export const dynamic = 'force-dynamic';

export async function GET() {
  const escrowWallet = (process.env.ESCROW_WALLET_ADDRESS || process.env.NEXT_PUBLIC_ESCROW_WALLET_ADDRESS || DEFAULT_ESCROW).trim();
  const feeWallet = (process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || process.env.NEXT_PUBLIC_DEV_FEE_WALLET_ADDRESS || process.env.TREASURY_ADDRESS || process.env.NEXT_PUBLIC_TREASURY_ADDRESS || DEFAULT_FEE).trim();
  const tokenAddress = (process.env.BANKR_TOKEN_ADDRESS || process.env.NEXT_PUBLIC_BANKR_TOKEN_ADDRESS || DEFAULT_TOKEN).trim();

  return NextResponse.json({
    chain: 'base',
    token_address: tokenAddress,
    escrow_wallet: escrowWallet,
    fee_wallet: feeWallet,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
