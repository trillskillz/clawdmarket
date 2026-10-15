import 'server-only'
import { createHash } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { contract_acceptance_operations as decisions, contract_milestones, contracts, contract_submission_operations } from './schema'
import { originalReviewedContractUse } from './organization-contract-uses'
import { inspectOriginalReviewedContractSubmission } from './contract-original-submissions'
import { PurchasingError, purchasingTransaction, type PurchasingSource } from './organization-purchasing-transaction'
import { canonicalContract } from './structured-verification'
import { nextContractStateFromMilestones } from './contracts-state'

export const reviewedContractAcceptanceInput = z.object({ version: z.literal(1),
  client_reference: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  submission_id: z.uuid(), content_hash: z.string().regex(/^[a-f0-9]{64}$/), approve: z.literal(true),
}).strict()
type Input = z.output<typeof reviewedContractAcceptanceInput>
function fail(code: string, status = 409): never { throw new PurchasingError(code, status) }
const hash = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
function requestHash(contractId: string, milestoneId: string, buyer: string, authorityHash: string, input: Input) {
  return hash({ kind: 'reviewed-contract-buyer-acceptance-v1', contract_id: contractId, milestone_id: milestoneId,
    buyer_id: buyer, authority_hash: authorityHash, input })
}
async function dto(source: PurchasingSource, decision: typeof decisions.$inferSelect) {
  const original = await originalReviewedContractUse(source, decision.contract_id)
  if (!original || original.authorization.buyer_id !== decision.buyer_id || original.use.authorization_id !== decision.authorization_id
    || original.use.authority_hash !== decision.authority_hash) fail('CONTRACT_ACCEPTANCE_RECORD_INVALID')
  const view = await inspectOriginalReviewedContractSubmission(source, decision.contract_id, decision.milestone_id, decision.buyer_id)
  const [submission] = await source.select().from(contract_submission_operations).where(eq(contract_submission_operations.submission_id, decision.submission_id)).limit(1)
  if (!submission || submission.contract_id !== decision.contract_id || submission.milestone_id !== decision.milestone_id
    || submission.authorization_id !== decision.authorization_id || submission.authority_hash !== decision.authority_hash
    || submission.content_hash !== decision.content_hash) fail('CONTRACT_ACCEPTANCE_RECORD_INVALID')
  const input = { version: 1 as const, client_reference: decision.client_reference, submission_id: decision.submission_id,
    content_hash: decision.content_hash, approve: true as const }
  if (decision.request_hash !== requestHash(decision.contract_id, decision.milestone_id, decision.buyer_id, decision.authority_hash, input)) fail('CONTRACT_ACCEPTANCE_RECORD_INVALID')
  return { decision: { id: decision.id, contract_id: decision.contract_id, milestone_id: decision.milestone_id,
    submission_id: decision.submission_id, content_hash: decision.content_hash, buyer_id: decision.buyer_id,
    client_reference: decision.client_reference, accepted_at: decision.accepted_at, kind: 'explicit_buyer_acceptance' as const },
    selected_submission_id: view.selected_submission_id, applies_to_current_submission: view.selected_submission_id === decision.submission_id,
    current_milestone_state: view.milestone_state, credit_remaining_principal_minor: original.remaining_principal_minor,
    financial_release_performed: false as const, semantic_accuracy: 'unmeasured' as const }
}

/** Internal buyer decision only. No public acceptance API or credit release is enabled. */
export async function acceptOriginalReviewedContract(contractId: string, milestoneId: string, buyer: string, rawInput: unknown) {
  const input = reviewedContractAcceptanceInput.parse(rawInput)
  return purchasingTransaction(async source => {
    const original = await originalReviewedContractUse(source, contractId)
    if (!original) fail('CONTRACT_REVIEWED_USE_REQUIRED')
    if (original.authorization.buyer_id !== buyer) fail('CONTRACT_ACCEPTANCE_BUYER_REQUIRED', 403)
    const digest = requestHash(contractId, milestoneId, buyer, original.use.authority_hash, input)
    const [prior] = await source.select().from(decisions).where(and(eq(decisions.buyer_id, buyer), eq(decisions.client_reference, input.client_reference))).limit(1)
    if (prior) {
      if (prior.contract_id !== contractId || prior.milestone_id !== milestoneId || prior.request_hash !== digest) fail('CONTRACT_ACCEPTANCE_REFERENCE_CONFLICT')
      return { ...await dto(source, prior), idempotent: true }
    }
    const view = await inspectOriginalReviewedContractSubmission(source, contractId, milestoneId, buyer)
    if (!view.submission || view.submission.id !== input.submission_id || view.submission.content_hash !== input.content_hash) fail('CONTRACT_ACCEPTANCE_SUBMISSION_CHANGED')
    const [existing] = await source.select({ id: decisions.id }).from(decisions).where(eq(decisions.submission_id, input.submission_id)).limit(1)
    if (existing) fail('CONTRACT_ACCEPTANCE_REFERENCE_CONFLICT')
    if (!['IN_PROGRESS', 'AWAITING_REVIEW'].includes(original.contract.state) || view.milestone_state !== 'AWAITING_BUYER_REVIEW'
      || view.submission.auto_check_result === 'fail') fail('CONTRACT_ACCEPTANCE_STATE_CHANGED')
    const required = view.original_requirements.acceptance_spec.required_artifacts
    if (required.some(key => !Object.hasOwn(view.submission!.artifact_bundle, key) || view.submission!.artifact_bundle[key] === null
      || view.submission!.artifact_bundle[key] === undefined || view.submission!.artifact_bundle[key] === '')) fail('CONTRACT_ACCEPTANCE_FINITE_CHECK_FAILED')
    const now = new Date()
    const [changed] = await source.update(contract_milestones).set({ state: 'APPROVED', updated_at: now }).where(and(
      eq(contract_milestones.id, milestoneId), eq(contract_milestones.contract_id, contractId),
      eq(contract_milestones.submission_id, input.submission_id), eq(contract_milestones.state, 'AWAITING_BUYER_REVIEW'))).returning()
    if (!changed) fail('CONTRACT_ACCEPTANCE_SUBMISSION_CHANGED')
    const [decision] = await source.insert(decisions).values({ submission_id: input.submission_id, authorization_id: original.use.authorization_id,
      authority_hash: original.use.authority_hash, contract_id: contractId, milestone_id: milestoneId, buyer_id: buyer,
      client_reference: input.client_reference, request_hash: digest, content_hash: input.content_hash, accepted_at: now }).returning()
    const milestones = await source.select().from(contract_milestones).where(eq(contract_milestones.contract_id, contractId)).orderBy(asc(contract_milestones.milestone_index))
    await source.update(contracts).set({ state: nextContractStateFromMilestones(milestones.map(m => m.state)), updated_at: now }).where(eq(contracts.id, contractId))
    return { ...await dto(source, decision), idempotent: false }
  })
}
