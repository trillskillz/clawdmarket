import 'server-only'
import { createHash } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { contracts, contract_creation_requests, contract_milestones, credit_entries, organization_contract_attributions,
  organization_contract_authorizations as grants, organization_contract_uses as uses, trades } from './schema'
import { canonicalContract } from './structured-verification'
import { validatedContractReviewTerms } from './organization-contract-authorizations'
import { PurchasingError, type PurchasingSource } from './organization-purchasing-transaction'

const digest = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
const fail = (): never => { throw new PurchasingError('ORGANIZATION_CONTRACT_USE_INVALID') }
function cents(value: number, allowZero = false) {
  const minor = Math.round(value * 100)
  if (!Number.isFinite(value) || !Number.isSafeInteger(minor) || minor < (allowZero ? 0 : 1) || Math.abs(value * 100 - minor) > .000001) fail()
  return minor
}

/** Validate historical reservation backing, never current permission or settlement/quality success.
 * This reader cannot create/fund a contract, mint authority or release credit. */
export async function originalReviewedContractUse(source: PurchasingSource, contractId: string) {
  const [use] = await source.select().from(uses).where(eq(uses.contract_id, contractId)).limit(1)
  if (!use) {
    const [review] = await source.select({ id: grants.id }).from(grants).where(eq(grants.contract_id, contractId)).limit(1)
    if (!review) return null // Ordinary historical contracts keep their original meaning.
    const [contract] = await source.select().from(contracts).where(eq(contracts.id, contractId)).limit(1)
    const [purchase] = await source.select({ id: credit_entries.id }).from(credit_entries)
      .where(and(eq(credit_entries.reference, contractId), eq(credit_entries.kind, 'purchase'))).limit(1)
    if (!contract || contract.funded_at || purchase || ['FUNDED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'DISPUTED', 'COMPLETED', 'REFUNDED'].includes(contract.state)) return fail()
    return null
  }
  const [row] = await source.select().from(grants).where(eq(grants.id, use.authorization_id)).limit(1)
  if (!row) return fail()
  const terms = validatedContractReviewTerms(row), original = terms.original
  const [contract] = await source.select().from(contracts).where(eq(contracts.id, contractId)).limit(1)
  const [creation] = await source.select().from(contract_creation_requests).where(eq(contract_creation_requests.contract_id, contractId)).limit(1)
  const [attribution] = await source.select().from(organization_contract_attributions).where(eq(organization_contract_attributions.contract_id, contractId)).limit(1)
  const milestones = await source.select().from(contract_milestones).where(eq(contract_milestones.contract_id, contractId)).orderBy(asc(contract_milestones.milestone_index))
  if (!contract || contract.state === 'DRAFT' || contract.payment_rail !== 'credit' || !contract.funded_at
    || row.contract_id !== contractId || original.contract_id !== contractId || row.buyer_id !== contract.buyer_id
    || row.seller_id !== contract.seller_id || row.buyer_id === row.seller_id || contract.organization_id !== row.organization_id
    || row.authority_hash !== use.authority_hash || row.state === 'pending' || !row.approved_at || !row.decision_reference
    || row.decision_hash !== digest({ version: 1, client_reference: row.decision_reference, authority_hash: row.authority_hash, approve: true })
    || !/^[A-Za-z0-9._:-]{8,128}$/.test(use.client_reference)
    || use.request_hash !== digest({ version: 1, client_reference: use.client_reference, authority_hash: row.authority_hash })
    || use.amount_minor !== original.gross_minor || cents(contract.total_amount) !== original.total_minor
    || cents(contract.fee_amount, true) !== original.fee_minor || cents(contract.escrow_amount) !== original.gross_minor
    || contract.listing_id !== original.listing_id || contract.funded_at.getTime() < row.approved_at.getTime()
    || !creation || creation.buyer_id !== row.buyer_id || creation.client_reference !== original.creation.client_reference
    || creation.request_hash !== original.creation.request_hash
    || contract.funded_at.getTime() !== use.created_at.getTime()
    || !attribution || attribution.organization_id !== row.organization_id || attribution.agent_id !== row.agent_id
    || attribution.team_id !== row.team_id || attribution.cost_center !== row.cost_center || attribution.total_minor !== original.gross_minor
    || attribution.created_at.getTime() !== use.created_at.getTime()
    || milestones.length !== original.milestones.length || milestones.some((m, i) => m.id !== original.milestones[i].id
      || m.milestone_index !== i || cents(m.amount) !== original.milestones[i].amount_minor)) return fail()
  // A contract cannot adopt another financial family's reference, even if an ID
  // was manually made to collide in otherwise separate identity tables.
  const [trade] = await source.select({ id: trades.id }).from(trades).where(eq(trades.id, contractId)).limit(1)
  if (trade) return fail()
  const entries = await source.select().from(credit_entries).where(eq(credit_entries.reference, contractId)).limit(1001)
  if (entries.length > 1000) return fail()
  const purchases = entries.filter(e => e.kind === 'purchase')
  const fees = entries.filter(e => e.kind === 'fee')
  if (purchases.length !== 1 || purchases[0].user_id !== row.buyer_id
    || purchases[0].available_delta !== -original.gross_minor || purchases[0].escrow_delta !== original.total_minor
    || purchases[0].created_at.getTime() < row.approved_at.getTime()
    || (original.fee_minor ? fees.length !== 1 || fees[0].user_id !== use.fee_recipient_id
      || fees[0].available_delta !== original.fee_minor || fees[0].escrow_delta !== 0 : fees.length !== 0)) return fail()
  let remainingPrincipal = 0
  for (const entry of entries) {
    if (![entry.available_delta, entry.escrow_delta].every(Number.isSafeInteger)) return fail()
    if (entry.user_id === row.buyer_id) remainingPrincipal += entry.escrow_delta
    if (!['purchase', 'fee'].includes(entry.kind) && !entry.kind.startsWith('contract_settlement:') && !entry.kind.startsWith('contract_sale:')) return fail()
    if (entry.kind.startsWith('contract_settlement:') && (entry.user_id !== row.buyer_id || entry.escrow_delta >= 0
      || entry.available_delta < 0 || entry.available_delta > -entry.escrow_delta)) return fail()
    if (entry.kind.startsWith('contract_sale:') && (entry.user_id !== row.seller_id || entry.escrow_delta !== 0 || entry.available_delta <= 0)) return fail()
    if (entry.kind.startsWith('contract_settlement:')) {
      const operation = entry.kind.slice('contract_settlement:'.length)
      const amount = operation === 'refund' ? original.total_minor : original.milestones.find(m => m.id === operation)?.amount_minor
      const sales = entries.filter(e => e.kind === `contract_sale:${operation}`)
      if (!amount || entry.escrow_delta !== -amount) return fail()
      const sellerAmount = amount - entry.available_delta
      if (sellerAmount ? sales.length !== 1 || sales[0].user_id !== row.seller_id || sales[0].available_delta !== sellerAmount || sales[0].escrow_delta !== 0 : sales.length !== 0) return fail()
    }
    if (entry.kind.startsWith('contract_sale:')) {
      const operation = entry.kind.slice('contract_sale:'.length)
      if (!entries.some(e => e.user_id === row.buyer_id && e.kind === `contract_settlement:${operation}`)) return fail()
    }
  }
  if (!Number.isSafeInteger(remainingPrincipal) || remainingPrincipal < 0 || remainingPrincipal > original.total_minor) return fail()
  return { authorization: row, terms, use, contract, remaining_principal_minor: remainingPrincipal }
}

/** Original gross remains charged after refund, cancellation, reassignment or settlement.
 * No chain fee is attributed to deposited credit. No adoption/quality claim is made. */
export async function organizationContractExposure(source: PurchasingSource, orgId: string, buyerId: string, excludeContractId = '') {
  const [orphan] = await source.all(sql`SELECT u.contract_id FROM organization_contract_uses u
    LEFT JOIN organization_contract_authorizations g ON g.id=u.authorization_id WHERE g.id IS NULL LIMIT 1`)
  if (orphan) return fail()
  const [unrecorded] = await source.all(sql`SELECT c.id FROM contracts c
    JOIN organization_contract_authorizations g ON g.contract_id=c.id
    WHERE g.organization_id=${orgId} AND g.buyer_id=${buyerId}
      AND (c.funded_at IS NOT NULL OR EXISTS(SELECT 1 FROM credit_entries e WHERE e.reference=c.id AND e.kind='purchase'))
      AND NOT EXISTS(SELECT 1 FROM organization_contract_uses u WHERE u.contract_id=c.id) LIMIT 1`)
  if (unrecorded) return fail()
  const history = await source.select({ use: uses }).from(uses).innerJoin(grants, eq(grants.id, uses.authorization_id))
    .where(and(eq(grants.organization_id, orgId), eq(grants.buyer_id, buyerId))).limit(10001)
  if (history.length > 10000) throw new PurchasingError('ORGANIZATION_CONTRACT_HISTORY_UNAVAILABLE', 503)
  let daily = 0, monthly = 0, lifetime = 0
  const now = new Date(), day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()), month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  for (const { use } of history) {
    const original = await originalReviewedContractUse(source, use.contract_id)
    if (!original) return fail()
    if (use.contract_id === excludeContractId) continue
    lifetime += use.amount_minor
    if (use.created_at.getTime() >= day) daily += use.amount_minor
    if (use.created_at.getTime() >= month) monthly += use.amount_minor
    if (![daily, monthly, lifetime].every(Number.isSafeInteger)) return fail()
  }
  return { daily, monthly, lifetime, gas: 0n, fees: 0n }
}
