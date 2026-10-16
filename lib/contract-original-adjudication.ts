import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { contract_adjudication_operations as operations, contract_disputes, credit_entries, contracts, contract_milestones } from './schema'
import { originalReviewedContractUse } from './organization-contract-uses'
import { PurchasingError, type PurchasingSource } from './organization-purchasing-transaction'
import { canonicalContract } from './structured-verification'

function fail(code = 'CONTRACT_ADJUDICATION_RECORD_INVALID', status = 409): never { throw new PurchasingError(code, status) }
type Record = typeof operations.$inferSelect
function hash(row: Omit<Record, 'decision_hash'>) {
  return createHash('sha256').update(canonicalContract({ kind: 'original-reviewed-contract-admin-adjudication-v1', ...row,
    resolved_at: row.resolved_at.toISOString() })).digest('hex')
}
function distribution(ruling: Record['ruling'], amount: number, percent: number | null) {
  if (ruling === 'redo') return { buyer: 0, seller: 0 }
  if (ruling === 'buyer_win') return { buyer: amount, seller: 0 }
  if (ruling === 'seller_win') return { buyer: 0, seller: amount }
  if (ruling !== 'split' || percent === null || !Number.isFinite(percent) || percent < 0 || percent > 100) fail()
  const seller = Math.round((amount / 100) * percent)
  return { buyer: amount - seller, seller }
}
async function validate(source: PurchasingSource, row: Record) {
  const original = await originalReviewedContractUse(source, row.contract_id)
  const [dispute] = await source.select().from(contract_disputes).where(eq(contract_disputes.id, row.dispute_id)).limit(1)
  const frozen = original?.terms.original.milestones.find(m => m.id === row.milestone_id)
  const { decision_hash, ...facts } = row
  if (!original || !frozen || !dispute || row.authorization_id !== original.use.authorization_id || row.authority_hash !== original.use.authority_hash
    || row.buyer_id !== original.authorization.buyer_id || row.seller_id !== original.authorization.seller_id
    || dispute.contract_id !== row.contract_id || dispute.milestone_id !== row.milestone_id || dispute.state !== 'resolved'
    || dispute.ruling !== row.ruling || dispute.resolved_at?.getTime() !== row.resolved_at.getTime()
    || frozen.amount_minor !== row.amount_minor || hash(facts) !== decision_hash || row.ruling !== 'split' && row.split_percent_to_seller !== null) fail()
  const expected = distribution(row.ruling, frozen.amount_minor, row.split_percent_to_seller)
  if (expected.buyer !== row.buyer_refund_minor || expected.seller !== row.seller_credit_minor) fail()
  const entries = await source.select().from(credit_entries).where(and(eq(credit_entries.reference, row.contract_id),
    eq(credit_entries.kind, `contract_settlement:${row.milestone_id}`)))
  const sales = await source.select().from(credit_entries).where(and(eq(credit_entries.reference, row.contract_id),
    eq(credit_entries.kind, `contract_sale:${row.milestone_id}`)))
  if (row.ruling === 'redo') {
    // A later legitimate ruling/release may settle this milestone. The redo
    // itself pins no posting and must not adopt that later financial outcome.
    if (row.settlement_entry_id !== null || row.sale_entry_id !== null) fail()
  } else {
    if (entries.length !== 1 || entries[0].id !== row.settlement_entry_id || entries[0].user_id !== row.buyer_id
      || entries[0].available_delta !== expected.buyer || entries[0].escrow_delta !== -frozen.amount_minor) fail()
    if (expected.seller ? sales.length !== 1 || sales[0].id !== row.sale_entry_id || sales[0].user_id !== row.seller_id
      || sales[0].available_delta !== expected.seller || sales[0].escrow_delta !== 0 : sales.length !== 0 || row.sale_entry_id !== null) fail()
  }
  const [milestone] = await source.select().from(contract_milestones).where(eq(contract_milestones.id, row.milestone_id)).limit(1)
  if (!milestone || milestone.contract_id !== row.contract_id) fail()
  return { adjudication: { dispute_id: row.dispute_id, contract_id: row.contract_id, milestone_id: row.milestone_id,
    decided_by_account_id: row.decided_by_account_id, ruling: row.ruling, split_percent_to_seller: row.split_percent_to_seller,
    amount_minor: row.amount_minor, buyer_refund_minor: row.buyer_refund_minor, seller_credit_minor: row.seller_credit_minor,
    settlement_entry_id: row.settlement_entry_id, sale_entry_id: row.sale_entry_id, resolved_at: row.resolved_at,
    decision_hash, basis: 'admin_adjudication' as const, rail: 'credit' as const, seller_receives: 'nonwithdrawable_account_credit' as const },
    buyer_acceptance_created: false as const, financial_posting_confirmed: row.ruling !== 'redo',
    selected_submission_id: milestone.submission_id, current_milestone_state: milestone.state,
    credit_remaining_principal_minor: original.remaining_principal_minor, observed_at: new Date().toISOString() }
}

/** Call ONLY inside the already authenticated admin resolution financial transaction. */
export async function recordOriginalContractAdjudication(source: PurchasingSource, disputeId: string, actor: string, splitPercent: number | null) {
  const [dispute] = await source.select().from(contract_disputes).where(eq(contract_disputes.id, disputeId)).limit(1)
  if (!dispute || !dispute.milestone_id || dispute.state !== 'resolved' || !dispute.ruling || !dispute.resolved_at) fail()
  const original = await originalReviewedContractUse(source, dispute.contract_id)
  const frozen = original?.terms.original.milestones.find(m => m.id === dispute.milestone_id)
  if (!original || !frozen) fail()
  const expected = distribution(dispute.ruling, frozen.amount_minor, splitPercent)
  const [debit] = await source.select().from(credit_entries).where(and(eq(credit_entries.reference, dispute.contract_id), eq(credit_entries.kind, `contract_settlement:${dispute.milestone_id}`))).limit(1)
  const [sale] = await source.select().from(credit_entries).where(and(eq(credit_entries.reference, dispute.contract_id), eq(credit_entries.kind, `contract_sale:${dispute.milestone_id}`))).limit(1)
  if (dispute.ruling === 'redo' && (debit || sale)) fail()
  const values = { dispute_id: disputeId, contract_id: dispute.contract_id, milestone_id: dispute.milestone_id,
    authorization_id: original.use.authorization_id, authority_hash: original.use.authority_hash, buyer_id: original.authorization.buyer_id,
    seller_id: original.authorization.seller_id, decided_by_account_id: actor, ruling: dispute.ruling,
    split_percent_to_seller: splitPercent, amount_minor: frozen.amount_minor, buyer_refund_minor: expected.buyer, seller_credit_minor: expected.seller,
    settlement_entry_id: debit?.id ?? null, sale_entry_id: sale?.id ?? null, resolved_at: dispute.resolved_at }
  const [operation] = await source.insert(operations).values({ ...values, decision_hash: hash(values) }).returning()
  return validate(source, operation)
}

/** Pure evidence read; callers must enforce participant or authenticated admin access. */
export async function originalContractAdjudication(source: PurchasingSource, disputeId: string) {
  const [operation] = await source.select().from(operations).where(eq(operations.dispute_id, disputeId)).limit(1)
  if (!operation) fail('CONTRACT_ADJUDICATION_NOT_FOUND', 404)
  return validate(source, operation)
}

export async function inspectParticipantContractAdjudication(source: PurchasingSource, contractId: string, milestoneId: string, actor: string, disputeId: string) {
  const [participant] = await source.select().from(contracts).where(eq(contracts.id, contractId)).limit(1)
  if (!participant || ![participant.buyer_id, participant.seller_id].includes(actor)) fail('CONTRACT_ADJUDICATION_NOT_FOUND', 404)
  const [operation] = await source.select().from(operations).where(and(eq(operations.dispute_id, disputeId), eq(operations.contract_id, contractId), eq(operations.milestone_id, milestoneId))).limit(1)
  if (!operation || ![operation.buyer_id, operation.seller_id].includes(actor)) fail('CONTRACT_ADJUDICATION_NOT_FOUND', 404)
  return validate(source, operation)
}
