import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from './db'
import { verification_results } from './schema'
import { assertReadyForBuyerAcceptance } from './trade-acceptance'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Call alongside the authoritative trade state transition when possible. */
export async function advanceBuyerReview(tx: Transaction, tradeId: string, status: 'passed' | 'disputed' | 'skipped', expectedHash?: string) {
  if (status === 'passed') await assertReadyForBuyerAcceptance(tradeId, tx, expectedHash)
  const decision = status === 'passed' ? 'buyer_confirm' : status === 'skipped' ? 'auto_confirm' : 'trade_disputed'
  await tx.update(verification_results).set({
    status, score: status === 'passed' ? 1 : null,
    evidence_json: JSON.stringify({ decision }), updated_at: new Date(),
  }).where(and(eq(verification_results.trade_id, tradeId), isNotNull(verification_results.delivery_id), eq(verification_results.method, 'buyer_review'), eq(verification_results.status, 'pending')))
}

export async function markBuyerReviewAccepted(tradeId: string, expectedHash?: string) {
  return db.transaction((tx) => advanceBuyerReview(tx, tradeId, 'passed', expectedHash))
}
