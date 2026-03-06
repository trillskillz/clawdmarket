import { NextResponse } from 'next/server';

const FALLBACK = 0.0171;

export const dynamic = 'force-dynamic';

export async function GET() {
  const envRate = Number(process.env.NEXT_PUBLIC_BANKR_TO_KAS_RATE || process.env.BANKR_TO_KAS_RATE || FALLBACK);
  const rate = Number.isFinite(envRate) && envRate > 0 ? envRate : FALLBACK;

  return NextResponse.json(
    {
      bankr_to_kas: rate,
      source: 'configured_rate',
      updated_at: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    },
  );
}
