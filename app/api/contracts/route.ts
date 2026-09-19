import { NextRequest, NextResponse } from 'next/server';
import { asc, eq, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contract_milestones, contracts, listings, users } from '@/lib/schema';
import { createContractSchema } from '@/lib/validation';
import { validateCsrf } from '@/lib/csrf';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import { DEV_FEE_PERCENT } from '@/lib/settlement';
import { isPublicMarketplaceSeller } from '@/lib/listing-visibility';

export const dynamic = 'force-dynamic'

const CONTRACTS_V1_ENABLED = process.env.CONTRACTS_V1 !== 'false';

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function GET(req: NextRequest) {
  const auth = await resolveRequestPrincipal(req);

  if (!CONTRACTS_V1_ENABLED) return NextResponse.json({ error: 'Contracts feature disabled' }, { status: 404 });
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const requestedPage = Number(req.nextUrl.searchParams.get('page') || 1);
  const requestedLimit = Number(req.nextUrl.searchParams.get('limit') || 50);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 50;
  const participantWhere = or(eq(contracts.buyer_id, auth.userId), eq(contracts.seller_id, auth.userId));
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(contracts)
    .where(participantWhere);
  const total = Number(countRow?.count || 0);
  const rows = await db
    .select()
    .from(contracts)
    .where(participantWhere)
    .orderBy(sql`${contracts.created_at} desc`)
    .limit(limit)
    .offset((page - 1) * limit);

  return NextResponse.json({
    contracts: rows,
    page,
    limit,
    total,
    total_pages: Math.ceil(total / limit),
    has_more: page * limit < total,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const auth = await resolveRequestPrincipal(req);

  if (!CONTRACTS_V1_ENABLED) return NextResponse.json({ error: 'Contracts feature disabled' }, { status: 404 });
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.usesCookieAuth && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const validated = createContractSchema.parse(body);

    let sellerId = validated.seller_id || null;

    if (validated.listing_id) {
      const [listing] = await db
        .select({ id: listings.id, seller_id: listings.seller_id, status: listings.status })
        .from(listings)
        .where(eq(listings.id, validated.listing_id))
        .limit(1);
      if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
      if (listing.status !== 'active') return NextResponse.json({ error: 'Listing is not active' }, { status: 409 });
      if (!await isPublicMarketplaceSeller(listing.seller_id)) return NextResponse.json({ error: 'Listing is not available' }, { status: 409 });
      sellerId = listing.seller_id;
    }

    if (!sellerId) {
      return NextResponse.json({ error: 'seller_id or listing_id is required' }, { status: 400 });
    }
    if (!await isPublicMarketplaceSeller(sellerId)) {
      return NextResponse.json({ error: 'Seller is not available' }, { status: 409 });
    }

    if (sellerId === auth.userId) {
      return NextResponse.json({ error: 'Cannot open contract with yourself' }, { status: 400 });
    }

    const [seller] = await db.select({ id: users.id }).from(users).where(eq(users.id, sellerId)).limit(1);
    if (!seller) return NextResponse.json({ error: 'Seller not found' }, { status: 404 });

    const sellerTotal = round2(validated.milestones.reduce((sum, m) => sum + Number(m.amount), 0));
    const feeAmount = round2(sellerTotal * DEV_FEE_PERCENT);
    const escrowAmount = round2(sellerTotal + feeAmount);
    const expiresAt = new Date(Date.now() + validated.expires_in_hours * 60 * 60 * 1000);

    const created = await db.transaction(async (tx) => {
      const [contract] = await tx
        .insert(contracts)
        .values({
          buyer_id: auth.userId,
          seller_id: sellerId!,
          listing_id: validated.listing_id ?? null,
          total_amount: sellerTotal,
          fee_amount: feeAmount,
          escrow_amount: escrowAmount,
          state: 'DRAFT',
          expires_at: expiresAt,
        })
        .returning();

      const milestoneRows = validated.milestones.map((m, i) => ({
        contract_id: contract.id,
        milestone_index: i,
        title: m.title,
        amount: round2(m.amount),
        acceptance_spec: JSON.stringify(m.acceptance_spec || { required_artifacts: [] }),
        deadline_at: m.deadline_in_hours ? new Date(Date.now() + m.deadline_in_hours * 60 * 60 * 1000) : null,
        review_window_hours: m.review_window_hours ?? 24,
        state: 'PENDING' as const,
      }));

      await tx.insert(contract_milestones).values(milestoneRows);

      return contract;
    });

    const milestones = await db
      .select()
      .from(contract_milestones)
      .where(eq(contract_milestones.contract_id, created.id))
      .orderBy(asc(contract_milestones.milestone_index));

    return NextResponse.json({ contract: created, milestones }, { status: 201 });
  } catch (error: any) {
    if (error?.issues || error?.errors) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues || error.errors }, { status: 400 });
    }
    console.error('Create contract error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
