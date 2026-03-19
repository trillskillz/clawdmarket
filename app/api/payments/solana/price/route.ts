import { NextResponse } from 'next/server';

export async function GET() {
  const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
    next: { revalidate: 60 },
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(
    { sol_usd: Number(data?.solana?.usd || 0), timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' } },
  );
}
