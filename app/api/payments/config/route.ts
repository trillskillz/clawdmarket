import { NextResponse } from 'next/server';

const DEFAULT_ESCROW = '0x3E911a2EaFbE60ca538F659836d6DE60Db639D44';
const DEFAULT_FEE = '';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC on Base

export const dynamic = 'force-dynamic';

export async function GET() {
  const escrowWallet = (process.env.ESCROW_WALLET_ADDRESS || process.env.NEXT_PUBLIC_ESCROW_WALLET_ADDRESS || DEFAULT_ESCROW).trim();
  const feeWallet = (process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || process.env.NEXT_PUBLIC_DEV_FEE_WALLET_ADDRESS || process.env.TREASURY_ADDRESS || process.env.NEXT_PUBLIC_TREASURY_ADDRESS || DEFAULT_FEE).trim();
  const tokenAddress = (process.env.X402_TOKEN_ADDRESS || process.env.BANKR_TOKEN_ADDRESS || process.env.NEXT_PUBLIC_BANKR_TOKEN_ADDRESS || USDC_BASE).trim();

  return NextResponse.json({
    chain: 'base',
    token_address: tokenAddress,
    escrow_wallet: escrowWallet,
    fee_wallet: feeWallet,
    supported_protocols: ['mpp', 'x402'],
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
