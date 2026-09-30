import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { messages, service_definitions, service_orders, task_workspaces, trade_deliveries, trades, verification_results } from './schema'
import { encryptMessage } from './chat-crypto'
import { deliverySchema, requirementsSchema, verifyDelivery } from './delivery-validation'
import { deliverWebhookEvent } from './webhook-delivery'
import { advanceServiceOrder } from './service-order-state'
import { withKeyedWriteLock } from './service-reservation-lock'
import { evaluateVerification, outputSchemaV1, verificationPolicySchema, type VerificationResult } from './verification-policy'

export class DeliveryError extends Error {
  constructor(message: string, public status: number, public details?: unknown) { super(message) }
}

function sqliteBusy(error: unknown) {
  let current = error
  for (let depth = 0; current && depth < 6; depth += 1) {
    if (typeof current === 'object' && ('code' in current && String(current.code) === 'SQLITE_BUSY' || 'message' in current && /SQLITE_BUSY|database is locked/i.test(String(current.message)))) return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

export function submitTradeDelivery(tradeId: string, sellerId: string, input: unknown, expectedBuyerId?: string) {
  return withKeyedWriteLock(`delivery:${tradeId}`, () => submitTradeDeliveryUnlocked(tradeId, sellerId, input, expectedBuyerId))
}

async function submitTradeDeliveryUnlocked(tradeId: string, sellerId: string, input: unknown, expectedBuyerId?: string) {
  const parsed = deliverySchema.safeParse(input)
  if (!parsed.success) throw new DeliveryError('Invalid delivery', 400, parsed.error.issues)
  const serialized = JSON.stringify(parsed.data)
  if (Buffer.byteLength(serialized, 'utf8') > 50_000) throw new DeliveryError('Delivery exceeds 50 KB', 413)
  const [trade] = await db.select().from(trades).where(eq(trades.id, tradeId)).limit(1)
  if (!trade) throw new DeliveryError('Trade not found', 404)
  if (trade.seller_id !== sellerId) throw new DeliveryError('Only the seller can submit delivery', 403)
  if (expectedBuyerId && expectedBuyerId !== trade.buyer_id) throw new DeliveryError('Delivery must be addressed to the trade buyer', 403)
  const contentHash = createHash('sha256').update(serialized).digest('hex')
  const replay = async () => {
    const [existing] = await db.select().from(trade_deliveries).where(eq(trade_deliveries.trade_id, tradeId)).limit(1)
    if (!existing) return null
    if (existing.submitter_id !== sellerId || existing.content_hash !== contentHash) throw new DeliveryError('A different delivery was already submitted', 409)
    return { delivery: existing, message: null, trade, verification: JSON.parse(existing.verification), idempotent: true }
  }
  const prior = await replay()
  if (prior) return prior
  if (trade.status !== 'escrow_held') throw new DeliveryError('Trade is not awaiting delivery', 409)
  const [workspace] = await db.select().from(task_workspaces).where(eq(task_workspaces.trade_id, tradeId)).limit(1)
  const requirements = requirementsSchema.parse(workspace ? {
    ...workspace,
    acceptance_criteria: JSON.parse(workspace.acceptance_criteria),
    required_json_keys: JSON.parse(workspace.required_json_keys),
  } : {})
  const [service] = await db.select({ policy: service_definitions.verification_policy, output_schema: service_definitions.output_schema })
    .from(service_orders).innerJoin(service_definitions, eq(service_orders.service_id, service_definitions.id))
    .where(eq(service_orders.trade_id, tradeId)).limit(1)
  const policy = verificationPolicySchema.safeParse(service ? JSON.parse(service.policy) : { required: true, methods: ['buyer_review'] })
  if (!policy.success) throw new DeliveryError('Stored verification policy is unsupported', 409)
  if (service && policy.data.methods.includes('schema') && !outputSchemaV1.safeParse(JSON.parse(service.output_schema)).success) {
    throw new DeliveryError('Stored output schema is unsupported', 409)
  }
  const outcomes = evaluateVerification({ policy: policy.data, outputSchema: service ? JSON.parse(service.output_schema) : {}, delivery: parsed.data, legacyRequirements: requirements })
  const legacyVerification = verifyDelivery(parsed.data, requirements)
  const failed = outcomes.some((outcome) => outcome.status === 'failed') || legacyVerification.status === 'failed'
  const verification = { ...legacyVerification, status: failed ? 'failed' : outcomes.some((outcome) => outcome.status === 'passed') ? 'passed' : 'manual_review',
    methods: outcomes.map(({ method, status, score }) => ({ method, status, score })),
    categories: { delivery_received: !failed, structure_verified: !failed && outcomes.some((outcome) => ['structure', 'schema'].includes(outcome.method) && outcome.status === 'passed'), semantic_verified: false, buyer_accepted: false } }
  const evidenceRows = (deliveryId: string | null) => outcomes.map((outcome: VerificationResult) => ({
    id: crypto.randomUUID(), trade_id: tradeId, delivery_id: deliveryId, content_hash: contentHash,
    method: outcome.method, verifier: outcome.verifier, version: outcome.version,
    status: outcome.status, score: outcome.score, evidence_json: JSON.stringify(outcome.evidence), failure: outcome.failure,
  }))
  if (failed) {
    await db.insert(verification_results).values(evidenceRows(null).filter((row) => row.method !== 'buyer_review')).onConflictDoNothing()
    throw new DeliveryError('Delivery failed required verification checks', 422, verification)
  }
  const encrypted = await encryptMessage(JSON.stringify({ type: 'task_complete', trade_id: tradeId, ...parsed.data, content_hash: contentHash }))
  const commit = () => db.transaction(async (tx) => {
    const [updated] = await tx.update(trades).set({ status: 'pending_release', auto_confirm_at: new Date(Date.now() + 86400000).toISOString() })
      .where(and(eq(trades.id, tradeId), eq(trades.status, 'escrow_held'))).returning()
    if (!updated) throw new DeliveryError('Trade is not awaiting delivery', 409)
    await advanceServiceOrder(tx, tradeId, 'verifying')
    const [delivery] = await tx.insert(trade_deliveries).values({
      trade_id: tradeId, submitter_id: sellerId, summary: parsed.data.summary,
      delivery_url: parsed.data.delivery_url ?? null,
      artifact_json: parsed.data.artifact ? JSON.stringify(parsed.data.artifact) : null,
      content_hash: contentHash, verification: JSON.stringify(verification),
    }).returning()
    await tx.insert(verification_results).values(evidenceRows(delivery.id)).onConflictDoNothing()
    const [message] = await tx.insert(messages).values({
      sender_id: sellerId, receiver_id: trade.buyer_id,
      encrypted_content: encrypted.encrypted_content, nonce: encrypted.nonce,
    }).returning()
    return { delivery, message, trade: updated, verification }
  })
  let result: Awaited<ReturnType<typeof commit>> | null = null
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      result = await commit()
      break
    } catch (error) {
      if (sqliteBusy(error) && attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
        const raced = await replay()
        if (raced) return raced
        continue
      }
      const raced = await replay()
      if (raced) return raced
      throw error
    }
  }
  if (!result) throw new Error('DELIVERY_RESERVATION_UNAVAILABLE')
  await Promise.allSettled([
    deliverWebhookEvent(trade.buyer_id, 'message.received', { message_id: result.message.id, from_agent_id: sellerId, type: 'task_complete', trade_id: tradeId }),
    deliverWebhookEvent(trade.buyer_id, 'trade.status_changed', { trade_id: tradeId, new_status: 'pending_release' }),
    deliverWebhookEvent(sellerId, 'trade.status_changed', { trade_id: tradeId, new_status: 'pending_release' }),
  ])
  return { ...result, idempotent: false }
}
