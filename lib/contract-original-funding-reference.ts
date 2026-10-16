import 'server-only'
import { createHash } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { contracts, contract_milestones, organization_contract_funding_requests as requests } from './schema'
import { originalReviewedContractUse } from './organization-contract-uses'
import { canonicalContract } from './structured-verification'
import { PurchasingError, type PurchasingSource, type PurchasingTransaction } from './organization-purchasing-transaction'

export const originalContractFundingInput = z.object({ version: z.literal(1),
  client_reference: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  authority_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export type OriginalContractFundingInput = z.output<typeof originalContractFundingInput>
export const originalContractFundingHash = (input: OriginalContractFundingInput) => createHash('sha256').update(canonicalContract(input)).digest('hex')
function fail(code: string, status = 409): never { throw new PurchasingError(code, status) }

async function dto(source: PurchasingSource, request: typeof requests.$inferSelect) {
  const original = await originalReviewedContractUse(source, request.contract_id)
  if (!original || request.buyer_id !== original.authorization.buyer_id || request.organization_id !== original.authorization.organization_id
    || request.authorization_id !== original.use.authorization_id || request.authority_hash !== original.use.authority_hash
    || request.client_reference !== original.use.client_reference || request.request_hash !== original.use.request_hash
    || request.created_at.getTime() !== original.use.created_at.getTime()) fail('CONTRACT_FUND_REFERENCE_INVALID')
  const input = originalContractFundingInput.parse({ version: 1, client_reference: request.client_reference, authority_hash: request.authority_hash })
  if (originalContractFundingHash(input) !== request.request_hash) fail('CONTRACT_FUND_REFERENCE_INVALID')
  const [contract] = await source.select().from(contracts).where(eq(contracts.id, request.contract_id)).limit(1)
  const milestones = await source.select().from(contract_milestones).where(eq(contract_milestones.contract_id, request.contract_id)).orderBy(asc(contract_milestones.milestone_index))
  return { contract: contract!, milestones, original_terms: original.terms.original, funding: { id: request.id, organization_id: request.organization_id,
    authorization_id: request.authorization_id, contract_id: request.contract_id, buyer_id: request.buyer_id,
    client_reference: request.client_reference, request_hash: request.request_hash, authority_hash: request.authority_hash,
    created_at: request.created_at, gross_minor: original.terms.original.gross_minor, principal_minor: original.terms.original.total_minor,
    upfront_fee_minor: original.terms.original.fee_minor, fee_recipient_id: original.use.fee_recipient_id,
    rail: 'credit' as const, redeemable: false as const, seller_receives: 'nonwithdrawable_account_credit' as const },
    credit_remaining_principal_minor: original.remaining_principal_minor, observed_at: new Date().toISOString() }
}

/** Original buyer read only; no current assignment/owner/rail/expiry gate or funding authority. */
export async function inspectOriginalContractFunding(source: PurchasingSource, orgId: string, authorizationId: string, buyer: string, reference: string) {
  originalContractFundingInput.shape.client_reference.parse(reference)
  const [request] = await source.select().from(requests).where(and(eq(requests.buyer_id, buyer), eq(requests.client_reference, reference),
    eq(requests.organization_id, orgId), eq(requests.authorization_id, authorizationId))).limit(1)
  if (!request) fail('CONTRACT_FUND_REFERENCE_NOT_FOUND', 404)
  return dto(source, request)
}

/** Exact original replay check for a future funding transaction. Never creates/adopts a reference. */
export async function recoverOriginalContractFundingCommand(source: PurchasingSource, orgId: string, authorizationId: string,
  buyer: string, raw: unknown) {
  const input = originalContractFundingInput.parse(raw)
  const [prior] = await source.select().from(requests).where(and(eq(requests.buyer_id, buyer), eq(requests.client_reference, input.client_reference))).limit(1)
  if (!prior) return null
  if (prior.organization_id !== orgId || prior.authorization_id !== authorizationId || prior.request_hash !== originalContractFundingHash(input)) fail('CONTRACT_FUND_REFERENCE_CONFLICT')
  return { ...await dto(source, prior), idempotent: true as const }
}

/** Internal append ONLY alongside the future original credit/use/attribution write, never a backfill API. */
export async function recordOriginalContractFundingCommand(source: PurchasingTransaction, orgId: string, authorizationId: string,
  buyer: string, contractId: string, raw: unknown) {
  const input = originalContractFundingInput.parse(raw)
  const original = await originalReviewedContractUse(source, contractId)
  if (!original || original.use.authorization_id !== authorizationId || original.authorization.organization_id !== orgId
    || original.authorization.buyer_id !== buyer || original.use.client_reference !== input.client_reference
    || original.use.authority_hash !== input.authority_hash || original.use.request_hash !== originalContractFundingHash(input)) fail('CONTRACT_FUND_REFERENCE_INVALID')
  const [request] = await source.insert(requests).values({ buyer_id: buyer, organization_id: orgId, authorization_id: authorizationId,
    contract_id: contractId, client_reference: input.client_reference, request_hash: original.use.request_hash,
    authority_hash: input.authority_hash, created_at: original.use.created_at }).returning()
  return { ...await dto(source, request), idempotent: false as const }
}
