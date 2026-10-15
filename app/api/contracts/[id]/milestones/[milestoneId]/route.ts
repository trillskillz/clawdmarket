import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contract_disputes, contract_milestones, contract_submissions, contracts, organization_contract_authorizations } from '@/lib/schema';
import { originalReviewedContractUse } from '@/lib/organization-contract-uses';
import { PurchasingError } from '@/lib/organization-purchasing-transaction';
import { inspectOriginalReviewedContractSubmission, reviewedContractSubmissionLookup } from '@/lib/contract-original-submissions';
import { isLocalSqliteContention, readWithLocalContentionRecovery } from '@/lib/local-sqlite-read';
import { purchasingResult } from '@/lib/organization-purchasing-api';
import { acceptOriginalReviewedContract, inspectOriginalReviewedContractAcceptance, reviewedContractAcceptanceLookup } from '@/lib/contract-exact-acceptance';
import { ArtifactError, readBoundedJson } from '@/lib/private-artifacts';
import { milestoneActionSchema, isValidUUID } from '@/lib/validation';
import { canTransitionMilestone, nextContractStateFromMilestones } from '@/lib/contracts-state';
import { validateCsrf } from '@/lib/csrf';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import {
  ContractSettlementError,
  ensureContractWallets,
  releaseContractFunds,
} from '@/lib/contract-settlement';

export const dynamic = 'force-dynamic';

const CONTRACTS_V1_ENABLED = process.env.CONTRACTS_V1 !== 'false';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; milestoneId: string }> }) {
  const auth = await resolveRequestPrincipal(req), { id, milestoneId } = await params;
  if (!CONTRACTS_V1_ENABLED) return purchasingResult({ error: 'Contracts feature disabled' }, 404);
  if (!auth) return purchasingResult({ error: 'Unauthorized' }, 401);
  if (!isValidUUID(id) || !isValidUUID(milestoneId)) return purchasingResult({ error: 'Invalid contract or milestone ID' }, 400);
  try {
    const entries = Object.fromEntries(req.nextUrl.searchParams);
    if ([...req.nextUrl.searchParams.keys()].length !== Object.keys(entries).length) return purchasingResult({ error: 'Repeated lookup parameter' }, 400);
    if (Object.hasOwn(entries, 'acceptance_reference')) {
      const query = reviewedContractAcceptanceLookup.parse(entries);
      return purchasingResult(await readWithLocalContentionRecovery(source => inspectOriginalReviewedContractAcceptance(source, id, milestoneId, auth.userId, query.acceptance_reference)));
    }
    const query = reviewedContractSubmissionLookup.parse(entries);
    const result = await readWithLocalContentionRecovery(source => inspectOriginalReviewedContractSubmission(source, id, milestoneId, auth.userId, query.client_reference));
    return purchasingResult(result);
  } catch (error: any) {
    if (error instanceof PurchasingError) return purchasingResult({ error: error.message, code: error.code }, error.status);
    if (error?.issues || error?.errors) return purchasingResult({ error: 'Invalid submission lookup' }, 400);
    if (process.env.TURSO_DATABASE_URL?.startsWith('file:') && isLocalSqliteContention(error)) return purchasingResult({ error: 'Original submission unavailable', code: 'PURCHASING_STORAGE_BUSY' }, 503);
    console.error('Original contract submission read failed:', error);
    return purchasingResult({ error: 'Original submission unavailable' }, 503);
  }
}

class MilestoneActionError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

function runAutoChecks(acceptanceSpec: any, artifacts: Record<string, any>) {
  const required = Array.isArray(acceptanceSpec?.required_artifacts) ? acceptanceSpec.required_artifacts : [];
  const missing = required.filter((key: string) => artifacts?.[key] === undefined || artifacts?.[key] === null || artifacts?.[key] === '');
  if (missing.length > 0) return { result: 'fail' as const, report: { missing_required_artifacts: missing } };
  if (required.length > 0) return { result: 'pass' as const, report: { checked: required, status: 'all_required_present' } };
  return { result: 'inconclusive' as const, report: { status: 'no_required_artifacts_defined' } };
}

async function transitionMilestone(tx: any, milestone: typeof contract_milestones.$inferSelect, state: typeof contract_milestones.$inferSelect['state'], values: Record<string, unknown> = {}) {
  if (!canTransitionMilestone(milestone.state as any, state as any)) {
    throw new MilestoneActionError(`Invalid milestone transition ${milestone.state} -> ${state}`, 409);
  }
  const updated = await tx
    .update(contract_milestones)
    .set({ ...values, state, updated_at: new Date() })
    .where(and(eq(contract_milestones.id, milestone.id), eq(contract_milestones.state, milestone.state as any)))
    .returning({ id: contract_milestones.id });
  if (updated.length === 0) throw new MilestoneActionError('Milestone state changed; refresh and try again', 409);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; milestoneId: string }> },
) {
  const { id, milestoneId } = await params;
  const auth = await resolveRequestPrincipal(req);

  if (!CONTRACTS_V1_ENABLED) return NextResponse.json({ error: 'Contracts feature disabled' }, { status: 404 });
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.usesCookieAuth && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }
  if (!isValidUUID(id) || !isValidUUID(milestoneId)) {
    return NextResponse.json({ error: 'Invalid contract or milestone ID' }, { status: 400 });
  }

  try {
    // Retain legacy artifact capacity (100k JS characters) while bounding the HTTP body.
    const raw = await readBoundedJson(req, 512 * 1024);
    const validated = milestoneActionSchema.parse(raw);
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
    if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    if (contract.buyer_id !== auth.userId && contract.seller_id !== auth.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const [review] = await db.select({ id: organization_contract_authorizations.id }).from(organization_contract_authorizations)
      .where(eq(organization_contract_authorizations.contract_id, contract.id)).limit(1);
    if (!review && validated.action === 'approve' && ['version', 'client_reference', 'submission_id', 'content_hash', 'approve'].some(key => Object.hasOwn(raw, key))) {
      throw new PurchasingError('CONTRACT_REVIEWED_USE_REQUIRED');
    }
    if (review && validated.action === 'approve') {
      const { action: _action, ...input } = raw;
      const result = await acceptOriginalReviewedContract(id, milestoneId, auth.userId, input);
      return purchasingResult(result, result.idempotent ? 200 : 201);
    }
    if (review && ['submit', 'mark_paid'].includes(validated.action)) {
      return purchasingResult({ error: 'Original reviewed submission and payment operations are not enabled on this public path yet.',
        code: 'CONTRACT_REVIEWED_FULFILLMENT_UNAVAILABLE' }, 409);
    }
    if (['DRAFT', 'FUNDED', 'COMPLETED', 'CANCELED', 'EXPIRED', 'REFUNDED'].includes(contract.state)) {
      return NextResponse.json({ error: 'Contract is not accepting milestone actions' }, { status: 409 });
    }

    const [milestone] = await db
      .select()
      .from(contract_milestones)
      .where(and(eq(contract_milestones.id, milestoneId), eq(contract_milestones.contract_id, contract.id)))
      .limit(1);
    if (!milestone) return NextResponse.json({ error: 'Milestone not found' }, { status: 404 });

    if (validated.action === 'submit' && auth.userId !== contract.seller_id) {
      return NextResponse.json({ error: 'Only the seller can submit work' }, { status: 403 });
    }
    if (['approve', 'request_changes', 'mark_paid'].includes(validated.action) && auth.userId !== contract.buyer_id) {
      return NextResponse.json({ error: 'Only the buyer can perform this action' }, { status: 403 });
    }
    if (validated.action === 'mark_paid') {
      await ensureContractWallets(contract.buyer_id, contract.seller_id);
    }

    await db.transaction(async (tx) => {
      const now = new Date();
      if (review && !await originalReviewedContractUse(tx, contract.id)) throw new PurchasingError('CONTRACT_REVIEWED_USE_REQUIRED');

      if (validated.action === 'submit') {
        const acceptanceSpec = JSON.parse(milestone.acceptance_spec || '{}');
        const artifacts = validated.artifact_bundle || {};
        if (JSON.stringify(artifacts).length > 100_000) throw new MilestoneActionError('Artifact bundle is too large', 413);
        const check = runAutoChecks(acceptanceSpec, artifacts);
        const milestoneState = check.result === 'fail' ? 'AUTO_FAILED' : 'AWAITING_BUYER_REVIEW';
        if (!['ACTIVE', 'CHANGES_REQUESTED', 'AUTO_FAILED'].includes(milestone.state)) {
          throw new MilestoneActionError(`Milestone cannot be submitted from ${milestone.state}`, 409);
        }

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
        const updated = await tx
          .update(contract_milestones)
          .set({ submission_id: submission.id, state: milestoneState, updated_at: now })
          .where(and(eq(contract_milestones.id, milestone.id), eq(contract_milestones.state, milestone.state as any)))
          .returning({ id: contract_milestones.id });
        if (updated.length === 0) throw new MilestoneActionError('Milestone state changed; refresh and try again', 409);
      }

      if (validated.action === 'approve') {
        await transitionMilestone(tx, milestone, 'APPROVED');
      }

      if (validated.action === 'request_changes') {
        await transitionMilestone(tx, milestone, 'CHANGES_REQUESTED');
      }

      if (validated.action === 'mark_paid') {
        await transitionMilestone(tx, milestone, 'PAID');
        await releaseContractFunds(tx, {
          contractId: contract.id,
          milestoneId: milestone.id,
          buyerId: contract.buyer_id,
          sellerId: contract.seller_id,
          amount: milestone.amount,
        });

        const [nextMilestone] = await tx
          .select()
          .from(contract_milestones)
          .where(and(eq(contract_milestones.contract_id, contract.id), eq(contract_milestones.milestone_index, milestone.milestone_index + 1)))
          .limit(1);
        if (nextMilestone && canTransitionMilestone(nextMilestone.state as any, 'ACTIVE')) {
          await tx
            .update(contract_milestones)
            .set({ state: 'ACTIVE', updated_at: now })
            .where(and(eq(contract_milestones.id, nextMilestone.id), eq(contract_milestones.state, nextMilestone.state as any)));
        }
      }

      if (validated.action === 'open_dispute') {
        if (JSON.stringify(validated.evidence || {}).length > 50_000) throw new MilestoneActionError('Dispute evidence is too large', 413);
        await transitionMilestone(tx, milestone, 'DISPUTED');
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
        await tx
          .update(contracts)
          .set({ state: 'DISPUTED', dispute_id: dispute.id, updated_at: now })
          .where(and(eq(contracts.id, contract.id), eq(contracts.state, contract.state as any)));
      }

      const allMilestones = await tx
        .select({ index: contract_milestones.milestone_index, state: contract_milestones.state })
        .from(contract_milestones)
        .where(eq(contract_milestones.contract_id, contract.id))
        .orderBy(asc(contract_milestones.milestone_index));
      const derivedState = nextContractStateFromMilestones(allMilestones.map((item) => item.state as any));
      const activeMilestone = allMilestones.find((item) => !['PAID', 'REFUNDED'].includes(item.state));
      await tx
        .update(contracts)
        .set({
          state: derivedState as any,
          current_milestone_index: activeMilestone?.index ?? Math.max(0, allMilestones.length - 1),
          updated_at: now,
        })
        .where(eq(contracts.id, contract.id));
    });

    const [updatedContract] = await db.select().from(contracts).where(eq(contracts.id, contract.id)).limit(1);
    const milestones = await db
      .select()
      .from(contract_milestones)
      .where(eq(contract_milestones.contract_id, contract.id))
      .orderBy(asc(contract_milestones.milestone_index));
    return NextResponse.json({ contract: updatedContract, milestones });
  } catch (error: any) {
    if (error instanceof PurchasingError || error instanceof ArtifactError) return purchasingResult({ error: error.message, code: error.code }, error.status);
    if (error?.issues || error?.errors) {
      return purchasingResult({ error: 'Validation failed', details: error.issues || error.errors }, 400);
    }
    if (error instanceof ContractSettlementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof MilestoneActionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Milestone action error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
