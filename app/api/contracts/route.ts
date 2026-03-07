import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { contract_milestones, contracts, listings } from '@/lib/schema';
import { createContractSchema } from '@/lib/validation';
import { validateCsrf } from '@/lib/csrf';

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db
    .select()
    .from(contracts)
    .where(or(eq(contracts.buyer_id, auth.userId), eq(contracts.seller_id, auth.userId)))
    .orderBy(sql`${contracts.created_at} desc`);

  return NextResponse.json({ contracts: rows });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const validated = createContractSchema.parse(body);

    let sellerId = validated.seller_id || null;

    if (validated.listing_id) {
      const [listing] = await db
        .select({ id: listings.id, seller_id: listings.seller_id })
        .from(listings)
        .where(eq(listings.id, validated.listing_id))
        .limit(1);
      if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
      sellerId = listing.seller_id;
    }

    if (!sellerId) {
      return NextResponse.json({ error: 'seller_id or listing_id is required' }, { status: 400 });
    }

    if (sellerId === auth.userId) {
      return NextResponse.json({ error: 'Cannot open contract with yourself' }, { status: 400 });
    }

    const sellerTotal = round2(validated.milestones.reduce((sum, m) => sum + Number(m.amount), 0));
    const feeAmount = round2(sellerTotal * validated.fee_percent);
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
        state: i === 0 ? 'PENDING' : 'PENDING',
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
