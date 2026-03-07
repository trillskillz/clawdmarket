import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { contract_milestones, contracts } from '@/lib/schema';
import { contractActionSchema, isValidUUID } from '@/lib/validation';
import { canTransitionContract, canTransitionMilestone, nextContractStateFromMilestones } from '@/lib/contracts-state';
import { validateCsrf } from '@/lib/csrf';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Invalid contract ID' }, { status: 400 });

  const [contract] = await db.select().from(contracts).where(eq(contracts.id, params.id)).limit(1);
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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }
  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Invalid contract ID' }, { status: 400 });

  try {
    const body = await req.json();
    const validated = contractActionSchema.parse(body);

    const [contract] = await db.select().from(contracts).where(eq(contracts.id, params.id)).limit(1);
    if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });

    if (contract.buyer_id !== auth.userId && contract.seller_id !== auth.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const now = new Date();
    let nextState = contract.state;

    if (validated.action === 'fund') {
      if (auth.userId !== contract.buyer_id) return NextResponse.json({ error: 'Only buyer can fund' }, { status: 403 });
      nextState = 'FUNDED';
    }

    if (validated.action === 'start') {
      if (auth.userId !== contract.seller_id) return NextResponse.json({ error: 'Only seller can start' }, { status: 403 });
      nextState = 'IN_PROGRESS';
    }

    if (validated.action === 'cancel') {
      if (contract.state !== 'DRAFT' && contract.state !== 'FUNDED') {
        return NextResponse.json({ error: 'Only draft/funded contracts can be canceled' }, { status: 400 });
      }
      nextState = 'CANCELED';
    }

    if (validated.action === 'expire') {
      if (contract.expires_at && new Date(contract.expires_at).getTime() > Date.now()) {
        return NextResponse.json({ error: 'Contract has not expired yet' }, { status: 400 });
      }
      nextState = 'EXPIRED';
    }

    if (!canTransitionContract(contract.state as any, nextState as any) && nextState !== contract.state) {
      return NextResponse.json({ error: `Invalid transition ${contract.state} -> ${nextState}` }, { status: 400 });
    }

    await db.transaction(async (tx) => {
      if (validated.action === 'start') {
        const milestones = await tx
          .select()
          .from(contract_milestones)
          .where(eq(contract_milestones.contract_id, contract.id))
          .orderBy(asc(contract_milestones.milestone_index));

        const first = milestones[0];
        if (first && canTransitionMilestone(first.state as any, 'ACTIVE')) {
          await tx
            .update(contract_milestones)
            .set({ state: 'ACTIVE', updated_at: now })
            .where(eq(contract_milestones.id, first.id));
        }
      }

      await tx
        .update(contracts)
        .set({ state: nextState as any, updated_at: now })
        .where(and(eq(contracts.id, contract.id), eq(contracts.state, contract.state as any)));

      if (validated.action === 'fund') {
        const milestones = await tx
          .select({ state: contract_milestones.state })
          .from(contract_milestones)
          .where(eq(contract_milestones.contract_id, contract.id));
        const derived = nextContractStateFromMilestones(milestones.map((m) => m.state as any));
        if (derived !== 'FUNDED') {
          await tx.update(contracts).set({ state: 'FUNDED' }).where(eq(contracts.id, contract.id));
        }
      }
    });

    const [updated] = await db.select().from(contracts).where(eq(contracts.id, contract.id)).limit(1);
    return NextResponse.json({ contract: updated });
  } catch (error: any) {
    if (error?.issues || error?.errors) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues || error.errors }, { status: 400 });
    }
    console.error('Contract action error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
