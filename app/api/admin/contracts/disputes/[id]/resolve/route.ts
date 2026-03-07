import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { contract_disputes, contract_milestones, contracts } from '@/lib/schema';
import { isValidUUID } from '@/lib/validation';
import { validateCsrf } from '@/lib/csrf';
import { nextContractStateFromMilestones } from '@/lib/contracts-state';
import { ensureContractsSchema } from '@/lib/contracts-schema-ensure';

function isAdminUser(userId: string) {
  const list = (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(userId);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }
  if (!isAdminUser(auth.userId)) {
    return NextResponse.json({ error: 'Forbidden (admin only)' }, { status: 403 });
  }
  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Invalid dispute ID' }, { status: 400 });

  await ensureContractsSchema();

  try {
    const body = await req.json();
    const ruling = String(body?.ruling || '');
    if (!['buyer_win', 'seller_win', 'split', 'redo'].includes(ruling)) {
      return NextResponse.json({ error: 'Invalid ruling' }, { status: 400 });
    }

    const [dispute] = await db.select().from(contract_disputes).where(eq(contract_disputes.id, params.id)).limit(1);
    if (!dispute) return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    if (dispute.state !== 'open') return NextResponse.json({ error: 'Dispute already resolved' }, { status: 400 });

    await db.transaction(async (tx) => {
      const now = new Date();

      await tx
        .update(contract_disputes)
        .set({ state: 'resolved', ruling: ruling as any, resolved_at: now, updated_at: now })
        .where(eq(contract_disputes.id, dispute.id));

      if (dispute.milestone_id) {
        if (ruling === 'buyer_win') {
          await tx.update(contract_milestones).set({ state: 'REFUNDED', updated_at: now }).where(eq(contract_milestones.id, dispute.milestone_id));
        } else if (ruling === 'seller_win') {
          await tx.update(contract_milestones).set({ state: 'APPROVED', updated_at: now }).where(eq(contract_milestones.id, dispute.milestone_id));
        } else {
          await tx.update(contract_milestones).set({ state: 'ACTIVE', updated_at: now }).where(eq(contract_milestones.id, dispute.milestone_id));
        }
      }

      const milestones = await tx
        .select({ state: contract_milestones.state })
        .from(contract_milestones)
        .where(eq(contract_milestones.contract_id, dispute.contract_id))
        .orderBy(asc(contract_milestones.milestone_index));

      const nextState = nextContractStateFromMilestones(milestones.map((m) => m.state as any));
      await tx
        .update(contracts)
        .set({
          state: nextState as any,
          dispute_id: nextState === 'DISPUTED' ? dispute.id : null,
          updated_at: now,
        })
        .where(and(eq(contracts.id, dispute.contract_id)));
    });

    return NextResponse.json({ success: true, dispute_id: params.id, ruling });
  } catch (error) {
    console.error('Resolve dispute error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
