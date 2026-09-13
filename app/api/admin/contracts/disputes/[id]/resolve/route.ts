import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { contract_disputes, contract_milestones, contracts } from '@/lib/schema';
import { isValidUUID } from '@/lib/validation';
import { validateCsrf } from '@/lib/csrf';
import { nextContractStateFromMilestones } from '@/lib/contracts-state';
import { authorizeAdmin } from '@/lib/admin-auth';
import {
  ContractSettlementError,
  ensureContractWallets,
  refundContractFunds,
  releaseContractFunds,
  splitContractFunds,
} from '@/lib/contract-settlement';

export const dynamic = 'force-dynamic';

const resolutionSchema = z.discriminatedUnion('ruling', [
  z.object({ ruling: z.literal('buyer_win') }),
  z.object({ ruling: z.literal('seller_win') }),
  z.object({ ruling: z.literal('redo') }),
  z.object({ ruling: z.literal('split'), split_percent_to_seller: z.number().min(0).max(100) }),
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  const authError = authorizeAdmin(auth ? { userId: auth.userId, email: auth.email } : null);
  if (authError) return authError;
  if (!authHeader && !validateCsrf(req)) return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid dispute ID' }, { status: 400 });

  try {
    const resolution = resolutionSchema.parse(await req.json());
    const [dispute] = await db.select().from(contract_disputes).where(eq(contract_disputes.id, id)).limit(1);
    if (!dispute) return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    if (dispute.state !== 'open') return NextResponse.json({ error: 'Dispute already resolved' }, { status: 409 });
    if (!dispute.milestone_id) return NextResponse.json({ error: 'Dispute is not attached to a milestone' }, { status: 409 });

    const [contract] = await db.select().from(contracts).where(eq(contracts.id, dispute.contract_id)).limit(1);
    const [milestone] = await db
      .select()
      .from(contract_milestones)
      .where(and(eq(contract_milestones.id, dispute.milestone_id), eq(contract_milestones.contract_id, dispute.contract_id)))
      .limit(1);
    if (!contract || !milestone) return NextResponse.json({ error: 'Contract or milestone not found' }, { status: 404 });
    if (contract.state !== 'DISPUTED' || milestone.state !== 'DISPUTED') {
      return NextResponse.json({ error: 'Contract dispute state is inconsistent' }, { status: 409 });
    }

    await ensureContractWallets(contract.buyer_id, contract.seller_id);

    await db.transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx
        .update(contract_disputes)
        .set({ state: 'resolved', ruling: resolution.ruling, resolved_at: now, updated_at: now })
        .where(and(eq(contract_disputes.id, dispute.id), eq(contract_disputes.state, 'open')))
        .returning({ id: contract_disputes.id });
      if (claimed.length === 0) throw new Error('DISPUTE_ALREADY_RESOLVED');

      let nextMilestoneState: 'ACTIVE' | 'PAID' | 'REFUNDED';
      if (resolution.ruling === 'buyer_win') {
        await refundContractFunds(tx, {
          contractId: contract.id,
          milestoneId: milestone.id,
          buyerId: contract.buyer_id,
          amount: milestone.amount,
        });
        nextMilestoneState = 'REFUNDED';
      } else if (resolution.ruling === 'seller_win') {
        await releaseContractFunds(tx, {
          contractId: contract.id,
          milestoneId: milestone.id,
          buyerId: contract.buyer_id,
          sellerId: contract.seller_id,
          amount: milestone.amount,
        });
        nextMilestoneState = 'PAID';
      } else if (resolution.ruling === 'split') {
        await splitContractFunds(tx, {
          contractId: contract.id,
          milestoneId: milestone.id,
          buyerId: contract.buyer_id,
          sellerId: contract.seller_id,
          amount: milestone.amount,
          sellerPercent: resolution.split_percent_to_seller,
        });
        nextMilestoneState = 'PAID';
      } else {
        nextMilestoneState = 'ACTIVE';
      }

      const milestoneUpdated = await tx
        .update(contract_milestones)
        .set({ state: nextMilestoneState, updated_at: now })
        .where(and(eq(contract_milestones.id, milestone.id), eq(contract_milestones.state, 'DISPUTED')))
        .returning({ id: contract_milestones.id });
      if (milestoneUpdated.length === 0) throw new Error('MILESTONE_STATE_CHANGED');

      if (nextMilestoneState === 'PAID' || nextMilestoneState === 'REFUNDED') {
        const [nextMilestone] = await tx
          .select()
          .from(contract_milestones)
          .where(and(eq(contract_milestones.contract_id, contract.id), eq(contract_milestones.milestone_index, milestone.milestone_index + 1)))
          .limit(1);
        if (nextMilestone?.state === 'PENDING') {
          await tx.update(contract_milestones).set({ state: 'ACTIVE', updated_at: now }).where(and(eq(contract_milestones.id, nextMilestone.id), eq(contract_milestones.state, 'PENDING')));
        }
      }

      const milestones = await tx
        .select({ index: contract_milestones.milestone_index, state: contract_milestones.state })
        .from(contract_milestones)
        .where(eq(contract_milestones.contract_id, dispute.contract_id))
        .orderBy(asc(contract_milestones.milestone_index));
      const nextState = nextContractStateFromMilestones(milestones.map((item) => item.state as any));
      const activeMilestone = milestones.find((item) => !['PAID', 'REFUNDED'].includes(item.state));
      await tx
        .update(contracts)
        .set({
          state: nextState as any,
          dispute_id: null,
          current_milestone_index: activeMilestone?.index ?? Math.max(0, milestones.length - 1),
          updated_at: now,
        })
        .where(and(eq(contracts.id, dispute.contract_id), eq(contracts.state, 'DISPUTED')));
    });

    return NextResponse.json({ success: true, dispute_id: id, ...resolution });
  } catch (error: any) {
    if (error?.issues || error?.errors) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues || error.errors }, { status: 400 });
    }
    if (error instanceof ContractSettlementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error?.message === 'DISPUTE_ALREADY_RESOLVED' || error?.message === 'MILESTONE_STATE_CHANGED') {
      return NextResponse.json({ error: 'Dispute state changed; refresh and try again' }, { status: 409 });
    }
    console.error('Resolve dispute error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
