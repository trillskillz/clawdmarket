import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { contract_disputes, contract_milestones, contract_submissions, contracts } from '@/lib/schema';
import { milestoneActionSchema, isValidUUID } from '@/lib/validation';
import { canTransitionContract, canTransitionMilestone, nextContractStateFromMilestones } from '@/lib/contracts-state';
import { validateCsrf } from '@/lib/csrf';

function runAutoChecks(acceptanceSpec: any, artifacts: Record<string, any>) {
  const required = Array.isArray(acceptanceSpec?.required_artifacts) ? acceptanceSpec.required_artifacts : [];
  const missing = required.filter((k: string) => artifacts?.[k] === undefined || artifacts?.[k] === null || artifacts?.[k] === '');
  if (missing.length > 0) {
    return {
      result: 'fail' as const,
      report: { missing_required_artifacts: missing },
    };
  }
  if (required.length > 0) {
    return {
      result: 'pass' as const,
      report: { checked: required, status: 'all_required_present' },
    };
  }
  return {
    result: 'inconclusive' as const,
    report: { status: 'no_required_artifacts_defined' },
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; milestoneId: string } }
) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  if (!isValidUUID(params.id) || !isValidUUID(params.milestoneId)) {
    return NextResponse.json({ error: 'Invalid contract or milestone ID' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const validated = milestoneActionSchema.parse(body);

    const [contract] = await db.select().from(contracts).where(eq(contracts.id, params.id)).limit(1);
    if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });

    const [milestone] = await db
      .select()
      .from(contract_milestones)
      .where(and(eq(contract_milestones.id, params.milestoneId), eq(contract_milestones.contract_id, contract.id)))
      .limit(1);

    if (!milestone) return NextResponse.json({ error: 'Milestone not found' }, { status: 404 });

    if (contract.buyer_id !== auth.userId && contract.seller_id !== auth.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await db.transaction(async (tx) => {
      const now = new Date();

      if (validated.action === 'submit') {
        if (auth.userId !== contract.seller_id) throw new Error('Only seller can submit');
        if (!canTransitionMilestone(milestone.state as any, 'SUBMITTED')) {
          throw new Error(`Invalid milestone transition ${milestone.state} -> SUBMITTED`);
        }

        const acceptanceSpec = JSON.parse(milestone.acceptance_spec || '{}');
        const artifacts = validated.artifact_bundle || {};
        const check = runAutoChecks(acceptanceSpec, artifacts);

        const [submission] = await tx
          .insert(contract_submissions)
          .values({
            milestone_id: milestone.id,
            submitted_by: auth.userId,
            artifact_bundle: JSON.stringify(artifacts),
            auto_check_result: check.result,
            auto_check_report: JSON.stringify(check.report),
          })
          .returning();

        const milestoneState = check.result === 'fail' ? 'AUTO_FAILED' : 'AWAITING_BUYER_REVIEW';
        await tx
          .update(contract_milestones)
          .set({
            submission_id: submission.id,
            state: milestoneState as any,
            updated_at: now,
          })
          .where(eq(contract_milestones.id, milestone.id));
      }

      if (validated.action === 'approve') {
        if (auth.userId !== contract.buyer_id) throw new Error('Only buyer can approve');
        if (!canTransitionMilestone(milestone.state as any, 'APPROVED')) {
          throw new Error(`Invalid milestone transition ${milestone.state} -> APPROVED`);
        }

        await tx.update(contract_milestones).set({ state: 'APPROVED', updated_at: now }).where(eq(contract_milestones.id, milestone.id));
      }

      if (validated.action === 'request_changes') {
        if (auth.userId !== contract.buyer_id) throw new Error('Only buyer can request changes');
        if (!canTransitionMilestone(milestone.state as any, 'CHANGES_REQUESTED')) {
          throw new Error(`Invalid milestone transition ${milestone.state} -> CHANGES_REQUESTED`);
        }

        await tx.update(contract_milestones).set({ state: 'CHANGES_REQUESTED', updated_at: now }).where(eq(contract_milestones.id, milestone.id));
      }

      if (validated.action === 'mark_paid') {
        if (auth.userId !== contract.buyer_id) throw new Error('Only buyer can mark paid');
        if (!canTransitionMilestone(milestone.state as any, 'PAID')) {
          throw new Error(`Invalid milestone transition ${milestone.state} -> PAID`);
        }

        await tx.update(contract_milestones).set({ state: 'PAID', updated_at: now }).where(eq(contract_milestones.id, milestone.id));

        const [nextMilestone] = await tx
          .select()
          .from(contract_milestones)
          .where(and(eq(contract_milestones.contract_id, contract.id), eq(contract_milestones.milestone_index, milestone.milestone_index + 1)))
          .limit(1);

        if (nextMilestone && canTransitionMilestone(nextMilestone.state as any, 'ACTIVE')) {
          await tx.update(contract_milestones).set({ state: 'ACTIVE', updated_at: now }).where(eq(contract_milestones.id, nextMilestone.id));
        }
      }

      if (validated.action === 'open_dispute') {
        if (!canTransitionMilestone(milestone.state as any, 'DISPUTED')) {
          throw new Error(`Invalid milestone transition ${milestone.state} -> DISPUTED`);
        }

        const [dispute] = await tx
          .insert(contract_disputes)
          .values({
            contract_id: contract.id,
            milestone_id: milestone.id,
            raised_by: auth.userId,
            reason_code: validated.reason_code || 'unspecified',
            evidence: JSON.stringify(validated.evidence || {}),
            state: 'open',
          })
          .returning();

        await tx.update(contract_milestones).set({ state: 'DISPUTED', updated_at: now }).where(eq(contract_milestones.id, milestone.id));
        await tx.update(contracts).set({ state: 'DISPUTED', dispute_id: dispute.id, updated_at: now }).where(eq(contracts.id, contract.id));
      }

      if (validated.action === 'resolve_dispute') {
        if (auth.userId !== contract.buyer_id) throw new Error('Only buyer can resolve dispute currently');

        const [openDispute] = await tx
          .select()
          .from(contract_disputes)
          .where(and(eq(contract_disputes.contract_id, contract.id), eq(contract_disputes.milestone_id, milestone.id), eq(contract_disputes.state, 'open')))
          .limit(1);

        if (!openDispute) throw new Error('No open dispute for this milestone');

        const ruling = validated.ruling || 'redo';
        await tx
          .update(contract_disputes)
          .set({ state: 'resolved', ruling, resolved_at: now, updated_at: now })
          .where(eq(contract_disputes.id, openDispute.id));

        if (ruling === 'buyer_win') {
          await tx.update(contract_milestones).set({ state: 'REFUNDED', updated_at: now }).where(eq(contract_milestones.id, milestone.id));
        } else if (ruling === 'seller_win') {
          await tx.update(contract_milestones).set({ state: 'APPROVED', updated_at: now }).where(eq(contract_milestones.id, milestone.id));
        } else {
          await tx.update(contract_milestones).set({ state: 'ACTIVE', updated_at: now }).where(eq(contract_milestones.id, milestone.id));
        }
      }

      const allMilestones = await tx
        .select({ state: contract_milestones.state })
        .from(contract_milestones)
        .where(eq(contract_milestones.contract_id, contract.id))
        .orderBy(asc(contract_milestones.milestone_index));

      const derivedState = nextContractStateFromMilestones(allMilestones.map((m) => m.state as any));
      if (canTransitionContract(contract.state as any, derivedState as any) || contract.state === derivedState) {
        await tx.update(contracts).set({ state: derivedState as any, updated_at: now }).where(eq(contracts.id, contract.id));
      }
    });

    const [updatedContract] = await db.select().from(contracts).where(eq(contracts.id, contract.id)).limit(1);
    const milestones = await db
      .select()
      .from(contract_milestones)
      .where(eq(contract_milestones.contract_id, contract.id))
      .orderBy(asc(contract_milestones.milestone_index));

    return NextResponse.json({ contract: updatedContract, milestones });
  } catch (error: any) {
    if (error?.issues || error?.errors) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues || error.errors }, { status: 400 });
    }
    const message = error?.message || 'Internal server error';
    const status = message.includes('Invalid milestone transition') || message.includes('Only ') || message.includes('No open dispute') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
