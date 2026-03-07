import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contract_milestones, contracts } from '@/lib/schema';
import { nextContractStateFromMilestones } from '@/lib/contracts-state';
import { ensureContractsSchema } from '@/lib/contracts-schema-ensure';

function isAuthorized(req: NextRequest) {
  const expected = process.env.MAINTENANCE_SECRET || '';
  if (!expected) return false;
  const gotHeader = req.headers.get('x-maintenance-secret') || '';
  const gotQuery = req.nextUrl.searchParams.get('secret') || '';
  const authz = req.headers.get('authorization') || '';
  const bearer = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  return gotHeader === expected || gotQuery === expected || bearer === expected;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureContractsSchema();

  const now = new Date();
  let expiredContracts = 0;
  let autoApprovedMilestones = 0;

  await db.transaction(async (tx) => {
    const expirable = await tx
      .select({ id: contracts.id })
      .from(contracts)
      .where(
        and(
          inArray(contracts.state, ['FUNDED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'DISPUTED']),
          sql`${contracts.expires_at} IS NOT NULL`,
          sql`${contracts.expires_at} <= ${now}`,
        )
      );

    if (expirable.length > 0) {
      await tx
        .update(contracts)
        .set({ state: 'EXPIRED', updated_at: now })
        .where(inArray(contracts.id, expirable.map((c) => c.id)));
      expiredContracts += expirable.length;
    }

    const reviewMilestones = await tx
      .select({
        id: contract_milestones.id,
        contract_id: contract_milestones.contract_id,
        review_window_hours: contract_milestones.review_window_hours,
        updated_at: contract_milestones.updated_at,
      })
      .from(contract_milestones)
      .where(eq(contract_milestones.state, 'AWAITING_BUYER_REVIEW'));

    for (const m of reviewMilestones) {
      const reviewedAt = new Date(m.updated_at as any).getTime();
      const deadline = reviewedAt + Number(m.review_window_hours || 24) * 60 * 60 * 1000;
      if (deadline <= now.getTime()) {
        await tx
          .update(contract_milestones)
          .set({ state: 'APPROVED', updated_at: now })
          .where(eq(contract_milestones.id, m.id));
        autoApprovedMilestones += 1;
      }
    }

    const touchedContracts = await tx
      .select({ id: contracts.id })
      .from(contracts)
      .where(or(eq(contracts.state, 'IN_PROGRESS'), eq(contracts.state, 'AWAITING_REVIEW'), eq(contracts.state, 'DISPUTED')));

    for (const c of touchedContracts) {
      const ms = await tx
        .select({ state: contract_milestones.state })
        .from(contract_milestones)
        .where(eq(contract_milestones.contract_id, c.id))
        .orderBy(asc(contract_milestones.milestone_index));
      const derived = nextContractStateFromMilestones(ms.map((x) => x.state as any));
      await tx.update(contracts).set({ state: derived as any, updated_at: now }).where(eq(contracts.id, c.id));
    }
  });

  return NextResponse.json({
    success: true,
    expired_contracts: expiredContracts,
    auto_approved_milestones: autoApprovedMilestones,
    ran_at: now.toISOString(),
  });
}
