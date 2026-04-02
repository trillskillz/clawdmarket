import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listings } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';
import { FALLBACK_LISTINGS } from '@/lib/marketplace-fallback';

export const dynamic = 'force-dynamic'

const DEV_FEE_PERCENT = 0.05;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const listingId = String(body?.listing_id || '');
    if (!listingId) {
      return NextResponse.json({ error: 'listing_id is required' }, { status: 400 });
    }

    let [listing] = await db.select({ id: listings.id, price_bankr: listings.price_bankr }).from(listings).where(eq(listings.id, listingId)).limit(1);

    if ((!listing || !Number.isFinite(Number(listing.price_bankr))) && listingId) {
      try {
        const [legacyClawd] = await db
          .select({ id: listings.id, price_bankr: sql<number>`CAST(${sql.raw('price_clawd')} AS REAL)` })
          .from(listings)
          .where(eq(listings.id, listingId))
          .limit(1);
        if (legacyClawd && Number.isFinite(Number(legacyClawd.price_bankr))) listing = legacyClawd as any;
      } catch {}

      if (!listing || !Number.isFinite(Number(listing.price_bankr))) {
        try {
          const [legacyPrice] = await db
            .select({ id: listings.id, price_bankr: sql<number>`CAST(${sql.raw('price')} AS REAL)` })
            .from(listings)
            .where(eq(listings.id, listingId))
            .limit(1);
          if (legacyPrice && Number.isFinite(Number(legacyPrice.price_bankr))) listing = legacyPrice as any;
        } catch {}
      }
    }

    if (!listing && listingId.startsWith('fb-')) {
      const fallback = FALLBACK_LISTINGS.find((l) => l.id === listingId);
      if (fallback) {
        listing = { id: fallback.id, price_bankr: fallback.price_bankr } as any;
      }
    }

    if (!listing) {
      return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    }

    const item_price = Number(listing.price_bankr);
    if (!Number.isFinite(item_price)) {
      return NextResponse.json({ error: 'Listing price unavailable' }, { status: 500 });
    }
    const platform_fee = round2(item_price * DEV_FEE_PERCENT);
    const total_cost = round2(item_price + platform_fee);

    return NextResponse.json({
      listing_id: listing.id,
      item_price,
      platform_fee,
      total_cost,
      seller_amount: item_price,
      dev_amount: platform_fee,
      dev_wallet: (process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || process.env.ADMIN_BANKR_WALLET_ADDRESS || '').trim() || null,
      fee_percent: DEV_FEE_PERCENT,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 });
  }
}
