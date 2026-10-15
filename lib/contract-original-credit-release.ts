import 'server-only'
import { createHash } from 'node:crypto'
import { and, asc, eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { contract_acceptance_operations, contract_milestones, contract_release_operations as operations, contracts, credit_entries } from './schema'
import { originalReviewedContractUse } from './organization-contract-uses'
import { inspectOriginalReviewedContractAcceptance, reviewedContractAcceptanceInput } from './contract-exact-acceptance'
import { inspectOriginalReviewedContractSubmission } from './contract-original-submissions'
import { PurchasingError, purchasingTransaction, type PurchasingSource } from './organization-purchasing-transaction'
import { canonicalContract } from './structured-verification'
import { releaseContractFunds } from './contract-settlement'
import { nextContractStateFromMilestones } from './contracts-state'

export const originalContractReleaseInput = reviewedContractAcceptanceInput.omit({ approve: true }).extend({ acceptance_id: z.uuid() }).strict()
type Input = z.output<typeof originalContractReleaseInput>
function fail(code: string, status = 409): never { throw new PurchasingError(code, status) }
function digest(contract: string, milestone: string, buyer: string, authority: string, input: Input) {
  return createHash('sha256').update(canonicalContract({ kind: 'original-reviewed-contract-credit-release-v1',
    contract_id: contract, milestone_id: milestone, buyer_id: buyer, authority_hash: authority, input })).digest('hex')
}
async function dto(source: PurchasingSource, operation: typeof operations.$inferSelect) {
  const original = await originalReviewedContractUse(source, operation.contract_id)
  if (!original || original.authorization.buyer_id !== operation.buyer_id || original.authorization.seller_id !== operation.seller_id
    || original.use.authorization_id !== operation.authorization_id || original.use.authority_hash !== operation.authority_hash
    || original.terms.original.milestones.find(m => m.id === operation.milestone_id)?.amount_minor !== operation.amount_minor) fail('CONTRACT_RELEASE_RECORD_INVALID')
  const [acceptance] = await source.select().from(contract_acceptance_operations).where(eq(contract_acceptance_operations.id, operation.acceptance_id)).limit(1)
  if (!acceptance || acceptance.contract_id !== operation.contract_id || acceptance.milestone_id !== operation.milestone_id
    || acceptance.submission_id !== operation.submission_id || acceptance.content_hash !== operation.content_hash
    || acceptance.buyer_id !== operation.buyer_id || acceptance.authorization_id !== operation.authorization_id
    || acceptance.authority_hash !== operation.authority_hash) fail('CONTRACT_RELEASE_RECORD_INVALID')
  const decision = await inspectOriginalReviewedContractAcceptance(source, operation.contract_id, operation.milestone_id, operation.buyer_id, acceptance.client_reference)
  const input: Input = { version: 1, client_reference: operation.client_reference, acceptance_id: operation.acceptance_id,
    submission_id: operation.submission_id, content_hash: operation.content_hash }
  if (digest(operation.contract_id, operation.milestone_id, operation.buyer_id, operation.authority_hash, input) !== operation.request_hash) fail('CONTRACT_RELEASE_RECORD_INVALID')
  const entries = await source.select().from(credit_entries).where(or(eq(credit_entries.id, operation.settlement_entry_id), eq(credit_entries.id, operation.sale_entry_id)))
  const debit = entries.find(e => e.id === operation.settlement_entry_id), sale = entries.find(e => e.id === operation.sale_entry_id)
  if (entries.length !== 2 || !debit || !sale || debit.reference !== operation.contract_id || sale.reference !== operation.contract_id
    || debit.user_id !== operation.buyer_id || sale.user_id !== operation.seller_id
    || debit.kind !== `contract_settlement:${operation.milestone_id}` || sale.kind !== `contract_sale:${operation.milestone_id}`
    || debit.available_delta !== 0 || debit.escrow_delta !== -operation.amount_minor || sale.available_delta !== operation.amount_minor
    || sale.escrow_delta !== 0) fail('CONTRACT_RELEASE_RECORD_INVALID')
  return { release: { id: operation.id, contract_id: operation.contract_id, milestone_id: operation.milestone_id,
    acceptance_id: operation.acceptance_id, submission_id: operation.submission_id, content_hash: operation.content_hash,
    client_reference: operation.client_reference, amount_minor: operation.amount_minor, released_at: operation.released_at,
    basis: 'explicit_buyer_acceptance' as const, rail: 'credit' as const, seller_receives: 'nonwithdrawable_account_credit' as const,
    settlement_entry_id: debit.id, sale_entry_id: sale.id },
    financial_posting_confirmed: true as const, selected_submission_id: decision.selected_submission_id,
    current_milestone_state: decision.current_milestone_state, credit_remaining_principal_minor: original.remaining_principal_minor }
}

/** Internal original-reference recovery only. No public payment adapter is enabled. */
export async function inspectOriginalContractCreditRelease(source: PurchasingSource, contractId: string, milestoneId: string, actor: string, reference: string) {
  originalContractReleaseInput.shape.client_reference.parse(reference)
  const [contract] = await source.select().from(contracts).where(eq(contracts.id, contractId)).limit(1)
  if (!contract || ![contract.buyer_id, contract.seller_id].includes(actor)) fail('CONTRACT_RELEASE_NOT_FOUND', 404)
  const [operation] = await source.select().from(operations).where(and(eq(operations.contract_id, contractId),
    eq(operations.milestone_id, milestoneId), eq(operations.buyer_id, contract.buyer_id), eq(operations.client_reference, reference))).limit(1)
  if (!operation) fail('CONTRACT_RELEASE_NOT_FOUND', 404)
  return { ...await dto(source, operation), observed_at: new Date().toISOString() }
}

/** Internal credit-only financial command. Never invoke from the legacy mark_paid adapter. */
export async function releaseOriginalContractCredit(contractId: string, milestoneId: string, buyer: string, raw: unknown) {
  const input = originalContractReleaseInput.parse(raw)
  return purchasingTransaction(async source => {
    const original = await originalReviewedContractUse(source, contractId)
    if (!original) fail('CONTRACT_REVIEWED_USE_REQUIRED')
    if (original.authorization.buyer_id !== buyer) fail('CONTRACT_RELEASE_BUYER_REQUIRED', 403)
    const hash = digest(contractId, milestoneId, buyer, original.use.authority_hash, input)
    const [prior] = await source.select().from(operations).where(and(eq(operations.buyer_id, buyer), eq(operations.client_reference, input.client_reference))).limit(1)
    if (prior) {
      if (prior.contract_id !== contractId || prior.milestone_id !== milestoneId || prior.request_hash !== hash) fail('CONTRACT_RELEASE_REFERENCE_CONFLICT')
      return { ...await dto(source, prior), idempotent: true }
    }
    const [existing] = await source.select({ id: operations.id }).from(operations).where(eq(operations.milestone_id, milestoneId)).limit(1)
    if (existing) fail('CONTRACT_RELEASE_REFERENCE_CONFLICT')
    const [settled] = await source.select({ id: credit_entries.id }).from(credit_entries).where(and(
      eq(credit_entries.reference, contractId), eq(credit_entries.kind, `contract_settlement:${milestoneId}`))).limit(1)
    if (settled) fail('CONTRACT_RELEASE_ALREADY_SETTLED')
    const view = await inspectOriginalReviewedContractSubmission(source, contractId, milestoneId, buyer)
    if (!view.submission || view.selected_submission_id !== input.submission_id || view.submission.content_hash !== input.content_hash) fail('CONTRACT_RELEASE_SUBMISSION_CHANGED')
    const [acceptance] = await source.select().from(contract_acceptance_operations).where(eq(contract_acceptance_operations.id, input.acceptance_id)).limit(1)
    if (!acceptance || acceptance.contract_id !== contractId || acceptance.milestone_id !== milestoneId || acceptance.submission_id !== input.submission_id
      || acceptance.content_hash !== input.content_hash || acceptance.buyer_id !== buyer || acceptance.authority_hash !== original.use.authority_hash
      || acceptance.authorization_id !== original.use.authorization_id) fail('CONTRACT_RELEASE_EXACT_ACCEPTANCE_REQUIRED')
    const decision = await inspectOriginalReviewedContractAcceptance(source, contractId, milestoneId, buyer, acceptance.client_reference)
    if (!decision.applies_to_current_submission || decision.decision.id !== input.acceptance_id) fail('CONTRACT_RELEASE_EXACT_ACCEPTANCE_REQUIRED')
    if (!['IN_PROGRESS', 'AWAITING_REVIEW'].includes(original.contract.state) || view.milestone_state !== 'APPROVED') fail('CONTRACT_RELEASE_STATE_CHANGED')
    const frozen = original.terms.original.milestones.find(m => m.id === milestoneId)
    if (!frozen) fail('CONTRACT_RELEASE_RECORD_INVALID')
    const now = new Date()
    const [changed] = await source.update(contract_milestones).set({ state: 'PAID', updated_at: now }).where(and(
      eq(contract_milestones.id, milestoneId), eq(contract_milestones.contract_id, contractId),
      eq(contract_milestones.submission_id, input.submission_id), eq(contract_milestones.state, 'APPROVED'))).returning()
    if (!changed) fail('CONTRACT_RELEASE_STATE_CHANGED')
    await releaseContractFunds(source, { contractId, milestoneId, buyerId: buyer, sellerId: original.authorization.seller_id, amount: frozen.amount_minor / 100 })
    const [debit] = await source.select().from(credit_entries).where(and(eq(credit_entries.reference, contractId), eq(credit_entries.user_id, buyer), eq(credit_entries.kind, `contract_settlement:${milestoneId}`))).limit(1)
    const [sale] = await source.select().from(credit_entries).where(and(eq(credit_entries.reference, contractId), eq(credit_entries.user_id, original.authorization.seller_id), eq(credit_entries.kind, `contract_sale:${milestoneId}`))).limit(1)
    if (!debit || !sale) fail('CONTRACT_RELEASE_RECORD_INVALID')
    const [operation] = await source.insert(operations).values({ milestone_id: milestoneId, contract_id: contractId,
      authorization_id: original.use.authorization_id, authority_hash: original.use.authority_hash, acceptance_id: input.acceptance_id,
      submission_id: input.submission_id, content_hash: input.content_hash, buyer_id: buyer, seller_id: original.authorization.seller_id,
      client_reference: input.client_reference, request_hash: hash, amount_minor: frozen.amount_minor,
      settlement_entry_id: debit.id, sale_entry_id: sale.id, released_at: now }).returning()
    const [next] = await source.select().from(contract_milestones).where(and(eq(contract_milestones.contract_id, contractId),
      eq(contract_milestones.milestone_index, frozen.milestone_index + 1))).limit(1)
    if (next?.state === 'PENDING') await source.update(contract_milestones).set({ state: 'ACTIVE', updated_at: now }).where(and(eq(contract_milestones.id, next.id), eq(contract_milestones.state, 'PENDING')))
    const milestones = await source.select().from(contract_milestones).where(eq(contract_milestones.contract_id, contractId)).orderBy(asc(contract_milestones.milestone_index))
    await source.update(contracts).set({ state: nextContractStateFromMilestones(milestones.map(m => m.state)),
      current_milestone_index: milestones.find(m => !['PAID', 'REFUNDED'].includes(m.state))?.milestone_index ?? milestones.length - 1,
      updated_at: now }).where(eq(contracts.id, contractId))
    return { ...await dto(source, operation), idempotent: false }
  })
}
