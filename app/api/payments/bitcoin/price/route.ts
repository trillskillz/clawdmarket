import { NextResponse } from 'next/server';
import { getBtcPriceUsd } from '@/lib/bitcoin-payment';

export const dynamic = 'force-dynamic'

export async function GET() {
  const btc_usd = await getBtcPriceUsd();
  return NextResponse.json({ btc_usd, timestamp: new Date().toISOString() }, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' },
  });
}
