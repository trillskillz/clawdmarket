import 'server-only'
import { and, eq } from 'drizzle-orm'
import { contracts, listings, organization_contract_authorizations as grants, organization_contract_uses as uses, payment_controls } from './schema'
import { currentContractFundingReview } from './organization-contract-authorizations'
import { originalContractFundingInput, originalContractFundingHash, recoverOriginalContractFundingCommand, recordOriginalContractFundingCommand } from './contract-original-funding-reference'
import { assertReviewedContractGross } from './organization-contract-uses'
import { PurchasingError, purchasingTransaction } from './organization-purchasing-transaction'
import { NEW_PAYMENTS_CONTROL_KEY, NewPaymentsPausedError } from './payment-control'
import { issuePurchaseEvidence } from './organization-purchase-evidence'
import { enforceAgentSpendPolicy } from './agent-spend-policy'
import { attributeOrganizationContract } from './organization-budgets'
import { ensureAdminFeeRecipient } from './settlement'
import { lockContractFunds } from './contract-settlement'
import { requireContractListingScope } from './contract-listing-scope'
import { requireSellerPaymentRail } from './seller-payment-rails'
import { reviewedContractFundingEnabled } from './organization-contract-funding-policy'

/** One original reviewed credit reservation. No external claim/nonce/trade/service alias. */
export async function fundOriginalOrganizationContract(orgId: string, authorizationId: string, buyer: string, raw: unknown) {
  const input = originalContractFundingInput.parse(raw)
  return purchasingTransaction(async source => {
    const known = await recoverOriginalContractFundingCommand(source, orgId, authorizationId, buyer, input)
    if (known) return known // Original recovery precedes every fresh eligibility gate.
    if (!reviewedContractFundingEnabled()) throw new PurchasingError('ORGANIZATION_CONTRACT_FUNDING_DISABLED', 503)
    const [row] = await source.select().from(grants).where(and(eq(grants.id, authorizationId), eq(grants.organization_id, orgId), eq(grants.buyer_id, buyer))).limit(1)
    if (!row) throw new PurchasingError('ORGANIZATION_CONTRACT_NOT_FOUND', 404)
    if (row.authority_hash !== input.authority_hash) throw new PurchasingError('CONTRACT_FUND_AUTHORITY_CHANGED')
    const [used] = await source.select({ id: uses.authorization_id }).from(uses).where(eq(uses.authorization_id, row.id)).limit(1)
    if (used) throw new PurchasingError('CONTRACT_ORIGINAL_FUND_REFERENCE_REQUIRED')
    const terms = await currentContractFundingReview(row, source)
    const [control] = await source.select().from(payment_controls).where(eq(payment_controls.key, NEW_PAYMENTS_CONTROL_KEY)).limit(1)
    if (process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED === 'true' || control?.paused === 1) throw new NewPaymentsPausedError()
    await assertReviewedContractGross(source, row)
    const evidence = issuePurchaseEvidence({ approvalId: row.id, requestHash: row.request_hash, buyerId: buyer,
      totalMinor: terms.original.gross_minor, sellerId: row.seller_id, paymentRail: 'credit' })
    const now = new Date()
    await enforceAgentSpendPolicy(source, { agentId: row.agent_id, buyerId: buyer, totalCost: terms.original.gross_minor / 100,
      sellerId: row.seller_id, paymentRail: 'credit', verificationMethods: ['buyer_review'], purchaseEvidence: evidence, now })
    await requireSellerPaymentRail(row.seller_id, 'credit', source)
    if (terms.original.listing_id) {
      await requireContractListingScope(source, terms.original.listing_id, { expectedSeller: row.seller_id, fundingBuyer: buyer })
      const [claimed] = await source.update(listings).set({ status: 'sold' }).where(and(eq(listings.id, terms.original.listing_id),
        eq(listings.seller_id, row.seller_id), eq(listings.status, 'active'))).returning({ id: listings.id })
      if (!claimed) throw new PurchasingError('CONTRACT_LISTING_UNAVAILABLE')
    }
    const [funded] = await source.update(contracts).set({ state: 'FUNDED', payment_rail: 'credit', funded_at: now, updated_at: now })
      .where(and(eq(contracts.id, row.contract_id), eq(contracts.buyer_id, buyer), eq(contracts.seller_id, row.seller_id), eq(contracts.state, 'DRAFT'))).returning({ id: contracts.id })
    if (!funded) throw new PurchasingError('ORGANIZATION_CONTRACT_DRAFT_REQUIRED')
    await attributeOrganizationContract(source, row.agent_id, row.contract_id, terms.original.gross_minor, now)
    const feeRecipient = await ensureAdminFeeRecipient(source)
    await lockContractFunds(source, { contractId: row.contract_id, buyerId: buyer, sellerAmount: terms.original.total_minor / 100,
      feeAmount: terms.original.fee_minor / 100, feeRecipientId: feeRecipient })
    await source.insert(uses).values({ authorization_id: row.id, contract_id: row.contract_id, fee_recipient_id: feeRecipient,
      authority_hash: row.authority_hash, client_reference: input.client_reference, request_hash: originalContractFundingHash(input),
      amount_minor: terms.original.gross_minor, created_at: now })
    return recordOriginalContractFundingCommand(source, orgId, row.id, buyer, row.contract_id, input)
  })
}
