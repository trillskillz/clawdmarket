import crypto from 'crypto';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contract_milestones, contracts } from '@/lib/schema';
import { nextContractStateFromMilestones } from '@/lib/contracts-state';
import { ensureContractsSchema } from '@/lib/contracts-schema-ensure';
import { ensureContractWallets, refundContractFunds } from '@/lib/contract-settlement';

export const dynamic = 'force-dynamic'

function isAuthorized(req: NextRequest) {
  const expected = process.env.MAINTENANCE_SECRET || '';
  if (!expected) return false;
  const gotHeader = req.headers.get('x-maintenance-secret') || '';
  const authz = req.headers.get('authorization') || '';
  const bearer = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  return [gotHeader, bearer].some((candidate) => {
    if (candidate.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
  });
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureContractsSchema();

  const now = new Date();
  let expiredContracts = 0;
  let autoApprovedMilestones = 0;

  const expirable = await db
      .select({ id: contracts.id, buyer_id: contracts.buyer_id, seller_id: contracts.seller_id, total_amount: contracts.total_amount })
      .from(contracts)
      .where(
        and(
          eq(contracts.state, 'FUNDED'),
          sql`${contracts.expires_at} IS NOT NULL`,
          sql`${contracts.expires_at} <= ${now}`,
        )
      );

  for (const contract of expirable) {
    await ensureContractWallets(contract.buyer_id, contract.seller_id);
  }

  await db.transaction(async (tx) => {
    for (const contract of expirable) {
      const expired = await tx
        .update(contracts)
        .set({ state: 'REFUNDED', updated_at: now })
        .where(and(eq(contracts.id, contract.id), eq(contracts.state, 'FUNDED')))
        .returning({ id: contracts.id });

      if (expired.length > 0) {
        await refundContractFunds(tx, {
          contractId: contract.id,
          buyerId: contract.buyer_id,
          amount: contract.total_amount,
        });
        expiredContracts += 1;
      }
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
        const approved = await tx
          .update(contract_milestones)
          .set({ state: 'APPROVED', updated_at: now })
          .where(and(eq(contract_milestones.id, m.id), eq(contract_milestones.state, 'AWAITING_BUYER_REVIEW')))
          .returning({ id: contract_milestones.id });
        autoApprovedMilestones += approved.length;
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
