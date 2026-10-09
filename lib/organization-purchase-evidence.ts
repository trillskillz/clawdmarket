import 'server-only'

export type VerifiedPurchase = { approvalId: string; requestHash: string; buyerId: string; totalMinor: number; sellerId: string; paymentRail: string }
const validated = new WeakSet<object>()
/** Internal capability minted only after the purchasing module's transactional authority checks. */
export function issuePurchaseEvidence(value: VerifiedPurchase) {
  const evidence = Object.freeze({ ...value })
  validated.add(evidence)
  return evidence
}
export function purchaseThresholdSatisfied(evidence: VerifiedPurchase | undefined, context: { totalMinor: number; sellerId?: string; paymentRail?: string }) {
  return !!evidence && validated.has(evidence) && evidence.totalMinor === context.totalMinor
    && evidence.sellerId === context.sellerId && evidence.paymentRail === context.paymentRail
}
export function validPurchaseEvidence(evidence: VerifiedPurchase) { return validated.has(evidence) }
