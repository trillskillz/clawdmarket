import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contract_milestones, contracts } from '@/lib/schema';
import { contractActionSchema, isValidUUID } from '@/lib/validation';
import { canTransitionMilestone } from '@/lib/contracts-state';
import { validateCsrf } from '@/lib/csrf';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import {
  ContractSettlementError,
  ensureContractWallets,
  lockContractFunds,
  refundContractFunds,
} from '@/lib/contract-settlement';
import { ensureAdminFeeRecipient } from '@/lib/settlement';

export const dynamic = 'force-dynamic';

const CONTRACTS_V1_ENABLED = process.env.CONTRACTS_V1 !== 'false';

class ContractActionError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await resolveRequestPrincipal(req);

  if (!CONTRACTS_V1_ENABLED) return NextResponse.json({ error: 'Contracts feature disabled' }, { status: 404 });
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid contract ID' }, { status: 400 });

  const [contract] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
  if (contract.buyer_id !== auth.userId && contract.seller_id !== auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const milestones = await db
    .select()
    .from(contract_milestones)
    .where(eq(contract_milestones.contract_id, contract.id))
    .orderBy(asc(contract_milestones.milestone_index));

  return NextResponse.json({ contract, milestones });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await resolveRequestPrincipal(req);

  if (!CONTRACTS_V1_ENABLED) return NextResponse.json({ error: 'Contracts feature disabled' }, { status: 404 });
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.usesCookieAuth && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid contract ID' }, { status: 400 });

  try {
    const validated = contractActionSchema.parse(await req.json());
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
    if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    if (contract.buyer_id !== auth.userId && contract.seller_id !== auth.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (validated.action === 'fund' && auth.userId !== contract.buyer_id) {
      return NextResponse.json({ error: 'Only the buyer can fund this contract' }, { status: 403 });
    }
    if (validated.action === 'start' && auth.userId !== contract.seller_id) {
      return NextResponse.json({ error: 'Only the seller can start this contract' }, { status: 403 });
    }
    if (validated.action === 'cancel' && auth.userId !== contract.buyer_id) {
      return NextResponse.json({ error: 'Only the buyer can cancel this contract' }, { status: 403 });
    }

    let feeRecipientId: string | null = null;
    if (validated.action === 'fund') {
      await ensureContractWallets(contract.buyer_id, contract.seller_id);
      feeRecipientId = await ensureAdminFeeRecipient();
    }

    await db.transaction(async (tx) => {
      const now = new Date();

      if (validated.action === 'fund') {
        const claimed = await tx
          .update(contracts)
          .set({ state: 'FUNDED', updated_at: now })
          .where(and(eq(contracts.id, contract.id), eq(contracts.state, 'DRAFT')))
          .returning({ id: contracts.id });
        if (claimed.length === 0) throw new ContractActionError('Contract is no longer awaiting funding', 409);

        await lockContractFunds(tx, {
          contractId: contract.id,
          buyerId: contract.buyer_id,
          sellerAmount: contract.total_amount,
          feeAmount: contract.fee_amount,
          feeRecipientId,
        });
      }

      if (validated.action === 'start') {
        const claimed = await tx
          .update(contracts)
          .set({ state: 'IN_PROGRESS', updated_at: now })
          .where(and(eq(contracts.id, contract.id), eq(contracts.state, 'FUNDED')))
          .returning({ id: contracts.id });
        if (claimed.length === 0) throw new ContractActionError('Contract is not funded or has already started', 409);

        const [first] = await tx
          .select()
          .from(contract_milestones)
          .where(eq(contract_milestones.contract_id, contract.id))
          .orderBy(asc(contract_milestones.milestone_index))
          .limit(1);
        if (first && canTransitionMilestone(first.state as any, 'ACTIVE')) {
          await tx
            .update(contract_milestones)
            .set({ state: 'ACTIVE', updated_at: now })
            .where(and(eq(contract_milestones.id, first.id), eq(contract_milestones.state, first.state as any)));
        }
      }

      if (validated.action === 'cancel') {
        if (contract.state !== 'DRAFT' && contract.state !== 'FUNDED') {
          throw new ContractActionError('Only draft or funded contracts can be canceled', 409);
        }
        const canceled = await tx
          .update(contracts)
          .set({ state: 'CANCELED', updated_at: now })
          .where(and(eq(contracts.id, contract.id), eq(contracts.state, contract.state as any)))
          .returning({ id: contracts.id });
        if (canceled.length === 0) throw new ContractActionError('Contract state changed; refresh and try again', 409);
        if (contract.state === 'FUNDED') {
          await refundContractFunds(tx, {
            contractId: contract.id,
            buyerId: contract.buyer_id,
            amount: contract.total_amount,
          });
        }
      }

      if (validated.action === 'expire') {
        if (contract.state !== 'FUNDED') {
          throw new ContractActionError('Only an unstarted funded contract can expire', 409);
        }
        if (!contract.expires_at || new Date(contract.expires_at).getTime() > Date.now()) {
          throw new ContractActionError('Contract has not expired yet');
        }
        const expired = await tx
          .update(contracts)
          .set({ state: 'REFUNDED', updated_at: now })
          .where(and(eq(contracts.id, contract.id), eq(contracts.state, 'FUNDED')))
          .returning({ id: contracts.id });
        if (expired.length === 0) throw new ContractActionError('Contract state changed; refresh and try again', 409);
        await refundContractFunds(tx, {
          contractId: contract.id,
          buyerId: contract.buyer_id,
          amount: contract.total_amount,
        });
      }
    });

    const [updated] = await db.select().from(contracts).where(eq(contracts.id, contract.id)).limit(1);
    return NextResponse.json({ contract: updated });
  } catch (error: any) {
    if (error?.issues || error?.errors) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues || error.errors }, { status: 400 });
    }
    if (error instanceof ContractSettlementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === 'INSUFFICIENT_BALANCE' ? 402 : 409 });
    }
    if (error instanceof ContractActionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Contract action error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
