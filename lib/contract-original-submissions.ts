import 'server-only'
import { createHash } from 'node:crypto'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { contract_milestones, contracts, contract_submissions, contract_submission_operations as operations } from './schema'
import { originalReviewedContractUse } from './organization-contract-uses'
import { PurchasingError, purchasingTransaction, type PurchasingSource } from './organization-purchasing-transaction'
import { canonicalContract } from './structured-verification'
import { nextContractStateFromMilestones } from './contracts-state'

export const reviewedContractSubmissionInput = z.object({ version: z.literal(1),
  client_reference: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  artifact_bundle: z.record(z.string(), z.unknown()),
}).strict()
export const reviewedContractSubmissionLookup = z.object({ client_reference: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional() }).strict()
type Input = z.output<typeof reviewedContractSubmissionInput>
function fail(code: string, status = 409): never { throw new PurchasingError(code, status) }
const hash = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
function contentHash(contractId: string, milestoneId: string, seller: string, artifacts: Record<string, unknown>) {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: artifacts, depth: 0 }]
  let nodes = 0
  while (stack.length) {
    const item = stack.pop()!
    if (++nodes > 4096 || item.depth > 12 || typeof item.value === 'number' && !Number.isFinite(item.value)) fail('CONTRACT_SUBMISSION_INPUT_LIMIT', 400)
    if (item.value && typeof item.value === 'object') for (const child of Object.values(item.value)) stack.push({ value: child, depth: item.depth + 1 })
  }
  const canonical = canonicalContract(artifacts)
  if (Buffer.byteLength(canonical) > 65536) fail('CONTRACT_SUBMISSION_INPUT_LIMIT', 413)
  return hash({ kind: 'reviewed-contract-submission-v1', contract_id: contractId, milestone_id: milestoneId, seller_id: seller, artifact_bundle: artifacts })
}
const requestHash = (input: Input, content: string) => hash({ version: 1, action: 'submit', client_reference: input.client_reference, content_hash: content })
async function dto(source: PurchasingSource, operation: typeof operations.$inferSelect) {
  const original = await originalReviewedContractUse(source, operation.contract_id)
  const [submission] = await source.select().from(contract_submissions).where(eq(contract_submissions.id, operation.submission_id)).limit(1)
  const [milestone] = await source.select().from(contract_milestones).where(eq(contract_milestones.id, operation.milestone_id)).limit(1)
  if (!original || !submission || !milestone || milestone.contract_id !== operation.contract_id
    || operation.authorization_id !== original.use.authorization_id || operation.authority_hash !== original.use.authority_hash
    || operation.submitter_id !== original.authorization.seller_id || submission.milestone_id !== milestone.id
    || submission.submitted_by !== operation.submitter_id) fail('CONTRACT_SUBMISSION_RECORD_INVALID')
  let artifacts: Record<string, unknown>
  try { artifacts = z.record(z.string(), z.unknown()).parse(JSON.parse(submission.artifact_bundle)) }
  catch { return fail('CONTRACT_SUBMISSION_RECORD_INVALID') }
  if (contentHash(operation.contract_id, milestone.id, operation.submitter_id, artifacts) !== operation.content_hash
    || operation.request_hash !== requestHash({ version: 1, client_reference: operation.client_reference, artifact_bundle: artifacts }, operation.content_hash)) fail('CONTRACT_SUBMISSION_RECORD_INVALID')
  return { contract_id: operation.contract_id, contract_state: original.contract.state, milestone_id: milestone.id,
    credit_remaining_principal_minor: original.remaining_principal_minor,
    milestone_state: milestone.state, selected_submission_id: milestone.submission_id,
    superseded: milestone.submission_id !== submission.id,
    submission: { id: submission.id, submitted_by: submission.submitted_by, submitted_at: submission.submitted_at,
      content_hash: operation.content_hash, client_reference: operation.client_reference,
      artifact_bundle: artifacts, auto_check_result: submission.auto_check_result, auto_check_report: JSON.parse(submission.auto_check_report),
      semantic_accuracy: 'unmeasured' as const, remote_execution_observed: false as const, authorizes_payment: false as const } }
}

/** Original participants only; organizational review alone never exposes seller output. */
export async function inspectOriginalReviewedContractSubmission(source: PurchasingSource, contractId: string,
  milestoneId: string, actor: string, clientReference?: string) {
  if (clientReference !== undefined) reviewedContractSubmissionLookup.parse({ client_reference: clientReference })
  const [participant] = await source.select().from(contracts).where(eq(contracts.id, contractId)).limit(1)
  if (!participant || ![participant.buyer_id, participant.seller_id].includes(actor)) fail('CONTRACT_SUBMISSION_NOT_FOUND', 404)
  const original = await originalReviewedContractUse(source, contractId)
  if (!original || ![original.authorization.buyer_id, original.authorization.seller_id].includes(actor)) fail('CONTRACT_SUBMISSION_NOT_FOUND', 404)
  const [milestone] = await source.select().from(contract_milestones).where(and(eq(contract_milestones.id, milestoneId), eq(contract_milestones.contract_id, contractId))).limit(1)
  const frozen = original.terms.original.milestones.find(m => m.id === milestoneId)
  if (!milestone || !frozen) fail('CONTRACT_SUBMISSION_NOT_FOUND', 404)
  const [operation] = await source.select().from(operations).where(and(eq(operations.contract_id, contractId), eq(operations.milestone_id, milestoneId),
    clientReference === undefined ? eq(operations.submission_id, milestone.submission_id ?? '') : eq(operations.client_reference, clientReference))).limit(1)
  if (clientReference !== undefined && !operation || milestone.submission_id && !operation && clientReference === undefined) fail('CONTRACT_SUBMISSION_NOT_FOUND', 404)
  const empty = { contract_id: contractId, contract_state: original.contract.state, milestone_id: milestoneId, milestone_state: milestone.state,
    selected_submission_id: milestone.submission_id, credit_remaining_principal_minor: original.remaining_principal_minor,
    submission: null, superseded: false }
  return { ...(operation ? await dto(source, operation) : empty), original_requirements: frozen, observed_at: new Date().toISOString() }
}

/** Seller-only append/replay. Finite key presence never accepts output or releases credit.
 * This internal foundation has no public API/worker integration or funding authority. */
export async function submitOriginalReviewedContract(contractId: string, milestoneId: string, seller: string, rawInput: Input) {
  const input = reviewedContractSubmissionInput.parse(rawInput)
  const content = contentHash(contractId, milestoneId, seller, input.artifact_bundle), digest = requestHash(input, content)
  return purchasingTransaction(async source => {
    const original = await originalReviewedContractUse(source, contractId)
    if (!original) fail('CONTRACT_REVIEWED_USE_REQUIRED')
    if (original.authorization.seller_id !== seller) fail('CONTRACT_SUBMISSION_SELLER_REQUIRED', 403)
    const [prior] = await source.select().from(operations).where(and(eq(operations.submitter_id, seller), eq(operations.client_reference, input.client_reference))).limit(1)
    if (prior) {
      if (prior.contract_id !== contractId || prior.milestone_id !== milestoneId || prior.request_hash !== digest) fail('CONTRACT_SUBMISSION_REFERENCE_CONFLICT')
      return { ...await dto(source, prior), idempotent: true }
    }
    const [milestone] = await source.select().from(contract_milestones).where(and(eq(contract_milestones.id, milestoneId), eq(contract_milestones.contract_id, contractId))).limit(1)
    const frozen = original.terms.original.milestones.find(m => m.id === milestoneId)
    if (!milestone || !frozen || !['IN_PROGRESS', 'AWAITING_REVIEW'].includes(original.contract.state)
      || !['ACTIVE', 'CHANGES_REQUESTED', 'AUTO_FAILED'].includes(milestone.state)) fail('CONTRACT_SUBMISSION_STATE_CHANGED')
    const required = frozen.acceptance_spec.required_artifacts
    const missing = required.filter(key => !Object.hasOwn(input.artifact_bundle, key)
      || input.artifact_bundle[key] === undefined || input.artifact_bundle[key] === null || input.artifact_bundle[key] === '')
    const result = missing.length ? 'fail' as const : required.length ? 'pass' as const : 'inconclusive' as const
    const report = { checked: required, missing_required_artifacts: missing, evidence_scope: 'required_key_presence_only',
      semantic_accuracy: 'unmeasured', remote_execution_observed: false, authorizes_payment: false }
    const now = new Date()
    const [submission] = await source.insert(contract_submissions).values({ milestone_id: milestoneId, submitted_by: seller,
      artifact_bundle: JSON.stringify(input.artifact_bundle), auto_check_result: result, auto_check_report: JSON.stringify(report), submitted_at: now }).returning()
    const [updated] = await source.update(contract_milestones).set({ submission_id: submission.id, state: result === 'fail' ? 'AUTO_FAILED' : 'AWAITING_BUYER_REVIEW', updated_at: now })
      .where(and(eq(contract_milestones.id, milestoneId), eq(contract_milestones.state, milestone.state),
        milestone.submission_id ? eq(contract_milestones.submission_id, milestone.submission_id) : isNull(contract_milestones.submission_id))).returning()
    if (!updated) fail('CONTRACT_SUBMISSION_STATE_CHANGED')
    const [operation] = await source.insert(operations).values({ submission_id: submission.id, authorization_id: original.use.authorization_id,
      authority_hash: original.use.authority_hash, contract_id: contractId, milestone_id: milestoneId, submitter_id: seller,
      client_reference: input.client_reference, request_hash: digest, content_hash: content, created_at: now }).returning()
    const milestones = await source.select().from(contract_milestones).where(eq(contract_milestones.contract_id, contractId)).orderBy(asc(contract_milestones.milestone_index))
    await source.update(contracts).set({ state: nextContractStateFromMilestones(milestones.map(m => m.state)), updated_at: now }).where(eq(contracts.id, contractId))
    return { ...await dto(source, operation), idempotent: false }
  })
}
