import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { contract_disputes, contract_milestones, contracts, credit_entries, organization_contract_authorizations } from '@/lib/schema';
import { originalReviewedContractUse } from '@/lib/organization-contract-uses';
import { PurchasingError } from '@/lib/organization-purchasing-transaction';
import { originalContractAdjudication, recordOriginalContractAdjudication } from '@/lib/contract-original-adjudication';
import { purchasingResult } from '@/lib/organization-purchasing-api';
import { readWithLocalContentionRecovery } from '@/lib/local-sqlite-read';
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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authenticateRequest(req.headers.get('authorization') || (req.cookies.get('auth-token')?.value ? `Bearer ${req.cookies.get('auth-token')!.value}` : null));
  const denied = authorizeAdmin(auth ? { userId: auth.userId, email: auth.email } : null);
  if (denied) return denied;
  if (!isValidUUID(id) || req.nextUrl.searchParams.size) return purchasingResult({ error: 'Invalid original dispute reference' }, 400);
  try { return purchasingResult(await readWithLocalContentionRecovery(source => originalContractAdjudication(source, id))); }
  catch (error) {
    if (error instanceof PurchasingError) return purchasingResult({ error: error.message, code: error.code }, error.status);
    console.error('Original admin adjudication read failed:', error);
    return purchasingResult({ error: 'Original adjudication unavailable' }, 503);
  }
}

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

    let reviewedOutcome: { basis: 'admin_adjudication'; rail: 'credit'; distributed_minor: number } | undefined;
    await db.transaction(async (tx) => {
      const now = new Date();
      let settlementAmount = milestone.amount;
      const [review] = await tx.select({ id: organization_contract_authorizations.id }).from(organization_contract_authorizations)
        .where(eq(organization_contract_authorizations.contract_id, contract.id)).limit(1);
      if (review) {
        const original = await originalReviewedContractUse(tx, contract.id);
        const frozen = original?.terms.original.milestones.find(m => m.id === milestone.id);
        if (!original || !frozen || original.contract.state !== 'DISPUTED') throw new PurchasingError('CONTRACT_REVIEWED_DISPUTE_INVALID');
        const [settled] = await tx.select({ id: credit_entries.id }).from(credit_entries).where(and(
          eq(credit_entries.reference, contract.id), eq(credit_entries.kind, `contract_settlement:${milestone.id}`))).limit(1);
        if (settled) throw new PurchasingError('CONTRACT_REVIEWED_MILESTONE_ALREADY_SETTLED');
        settlementAmount = frozen.amount_minor / 100;
        reviewedOutcome = { basis: 'admin_adjudication', rail: 'credit', distributed_minor: resolution.ruling === 'redo' ? 0 : frozen.amount_minor };
      }
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
          amount: settlementAmount,
        });
        nextMilestoneState = 'REFUNDED';
      } else if (resolution.ruling === 'seller_win') {
        await releaseContractFunds(tx, {
          contractId: contract.id,
          milestoneId: milestone.id,
          buyerId: contract.buyer_id,
          sellerId: contract.seller_id,
          amount: settlementAmount,
        });
        nextMilestoneState = 'PAID';
      } else if (resolution.ruling === 'split') {
        await splitContractFunds(tx, {
          contractId: contract.id,
          milestoneId: milestone.id,
          buyerId: contract.buyer_id,
          sellerId: contract.seller_id,
          amount: settlementAmount,
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
      if (review) await recordOriginalContractAdjudication(tx, dispute.id, auth!.userId, resolution.ruling === 'split' ? resolution.split_percent_to_seller : null);
    });

    const result = { success: true, dispute_id: id, ...resolution, ...(reviewedOutcome ? { reviewed_outcome: reviewedOutcome } : {}) };
    return reviewedOutcome ? purchasingResult(result) : NextResponse.json(result);
  } catch (error: any) {
    if (error?.issues || error?.errors) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues || error.errors }, { status: 400 });
    }
    if (error instanceof ContractSettlementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof PurchasingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error?.message === 'DISPUTE_ALREADY_RESOLVED' || error?.message === 'MILESTONE_STATE_CHANGED') {
      return NextResponse.json({ error: 'Dispute state changed; refresh and try again' }, { status: 409 });
    }
    console.error('Resolve dispute error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
