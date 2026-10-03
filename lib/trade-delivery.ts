import { ArtifactError, loadDeliveryArtifacts } from './private-artifacts'
import { sourceEvidenceUrls } from './structured-verification'
import { serviceExecutionContract } from './service-execution-contract'
import { createHash } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from './db'
import { messages, service_definitions, service_execution_attempts, service_orders, task_workspaces, trade_deliveries, trades, verification_results, private_artifacts } from './schema'
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
  const [linkedService] = await db.select({ verification_policy: service_definitions.verification_policy, output_schema: service_definitions.output_schema,
    execution_contract_json: service_orders.execution_contract_json, provider_protocol: service_definitions.provider_protocol, order_id: service_orders.id })
    .from(service_orders).innerJoin(service_definitions, eq(service_orders.service_id, service_definitions.id))
    .where(eq(service_orders.trade_id, tradeId)).limit(1)
  const service = linkedService ? serviceExecutionContract(linkedService, linkedService) : null
  if (service?.provider_protocol === 'leased_v1') {
    const [attempt] = await db.select().from(service_execution_attempts)
      .where(eq(service_execution_attempts.order_id, service.order_id)).limit(1)
    if (!attempt || parsed.data.execution_attempt_id !== attempt.id || attempt.state !== 'accepted'
      || !attempt.lease_expires_at || attempt.lease_expires_at <= new Date()) {
      throw new DeliveryError('An accepted, active execution attempt is required for delivery', 409)
    }
  }
  const policy = verificationPolicySchema.safeParse(service ? JSON.parse(service.verification_policy) : { required: true, methods: ['buyer_review'] })
  if (!policy.success) throw new DeliveryError('Stored verification policy is unsupported', 409)
  if (service && policy.data.methods.includes('schema') && !outputSchemaV1.safeParse(JSON.parse(service.output_schema)).success) {
    throw new DeliveryError('Stored output schema is unsupported', 409)
  }
  const recordIntegrityFailure = async (error: unknown) => {
    if (error instanceof ArtifactError && error.code === 'ARTIFACT_INTEGRITY_FAILED') await db.insert(verification_results).values({
      id: crypto.randomUUID(), trade_id: tradeId, delivery_id: null, content_hash: contentHash, method: 'artifact_integrity_failure',
      verifier: 'clawdmarket-deterministic-v1', version: '1', status: 'failed', score: 0,
      evidence_json: JSON.stringify({ artifact_ids: parsed.data.artifact_ids, algorithm: 'sha256', urls_fetched: false, code_executed: false }), failure: 'artifact_integrity_failed',
    }).onConflictDoNothing()
  }
  const attachments = await loadDeliveryArtifacts(tradeId, parsed.data.artifact_ids || [], trade.status).catch(async (error) => { await recordIntegrityFailure(error); throw error })
  let structuredArtifact = parsed.data.artifact
  if (parsed.data.verification_artifact_id) {
    const selected = attachments.find(({ row }) => row.id === parsed.data.verification_artifact_id)!
    if (selected.row.media_type !== 'application/json') throw new DeliveryError('Verification artifact must be a JSON object', 400)
    const value = JSON.parse(selected.bytes.toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DeliveryError('Verification artifact must be a JSON object', 400)
    structuredArtifact = value
  }
  const verificationInput = { ...parsed.data, artifact: structuredArtifact }
  const assess = () => {
    const outcomes = evaluateVerification({ policy: policy.data, outputSchema: service ? JSON.parse(service.output_schema) : {}, delivery: verificationInput, legacyRequirements: requirements, now: new Date() })
    if (parsed.data.verification_artifact_id) for (const outcome of outcomes) if (outcome.status === 'failed') outcome.failure = `${outcome.method}_validation_failed`
    if (attachments.length) outcomes.push({ method: 'artifact_integrity', verifier: 'clawdmarket-deterministic-v1', version: '1', status: 'passed', score: 1,
      evidence: { algorithm: 'sha256', artifacts: attachments.map(({ row }) => ({ id: row.id, sha256: row.sha256, size_bytes: row.size_bytes, media_type: row.media_type })),
        verification_artifact_id: parsed.data.verification_artifact_id ?? null, urls_fetched: false, code_executed: false, provenance_verified: false }, failure: null })
    const legacyInput = policy.data.source_evidence ? { ...verificationInput, artifact: sourceEvidenceUrls(structuredArtifact) } : verificationInput
    const legacyVerification = verifyDelivery(legacyInput, requirements)
    const failed = outcomes.some((outcome) => outcome.status === 'failed') || legacyVerification.status === 'failed'
    const passed = (method: string) => !failed && outcomes.some((outcome) => outcome.method === method && outcome.status === 'passed')
    const verification = { ...legacyVerification, status: failed ? 'failed' : outcomes.some((outcome) => outcome.status === 'passed') ? 'passed' : 'manual_review',
      methods: outcomes.map(({ method, status, score }) => ({ method, status, score })),
      categories: { delivery_received: !failed, structure_verified: passed('structure') || passed('schema'), assertions_verified: passed('assertions'),
        declared_source_evidence_verified: passed('source_evidence'), semantic_verified: false, buyer_accepted: false } }
    return { outcomes, failed, verification }
  }
  const evidenceRows = (outcomes: VerificationResult[], deliveryId: string | null) => outcomes.map((outcome) => ({
    id: crypto.randomUUID(), trade_id: tradeId, delivery_id: deliveryId, content_hash: contentHash,
    method: outcome.method, verifier: outcome.verifier, version: outcome.version,
    status: outcome.status, score: outcome.score, evidence_json: JSON.stringify(outcome.evidence), failure: outcome.failure,
  }))
  // A time-dependent rejection and later acceptance of the exact body retain separate evidence.
  // New checks publish passing evidence only when the delivery transaction commits.
  const recordFailure = async (assessment: ReturnType<typeof assess>) => {
    const rows = evidenceRows(assessment.outcomes, null).filter((row) => row.method !== 'buyer_review'
      && (!['assertions', 'source_evidence'].includes(row.method) || row.status === 'failed'))
      .map((row) => ['assertions', 'source_evidence'].includes(row.method) ? { ...row, method: `${row.method}_failure` } : row)
    if (rows.length) await db.insert(verification_results).values(rows).onConflictDoNothing()
  }
  class RequiredCheckFailure extends DeliveryError {
    constructor(public assessment: ReturnType<typeof assess>) { super('Delivery failed required verification checks', 422, assessment.verification) }
  }
  const initial = assess()
  if (initial.failed) { await recordFailure(initial); throw new RequiredCheckFailure(initial) }
  const encrypted = await encryptMessage(JSON.stringify({ type: 'task_complete', trade_id: tradeId, ...parsed.data, content_hash: contentHash }))
  const commit = () => db.transaction(async (tx) => {
    // Recheck immutable file bindings inside the same transaction that opens review.
    const fresh = await loadDeliveryArtifacts(tradeId, parsed.data.artifact_ids || [], trade.status, tx)
    if (fresh.some(({ row }, index) => row.sha256 !== attachments[index].row.sha256 || row.request_hash !== attachments[index].row.request_hash)) throw new ArtifactError('ARTIFACT_INTEGRITY_FAILED', 422)
    const assessment = assess()
    if (assessment.failed) throw new RequiredCheckFailure(assessment)
    const { verification, outcomes } = assessment
    if (service?.provider_protocol === 'leased_v1') {
      const now = new Date()
      const [completed] = await tx.update(service_execution_attempts)
        .set({ state: 'delivered', completed_at: now, updated_at: now })
        .where(and(eq(service_execution_attempts.order_id, service.order_id),
          eq(service_execution_attempts.id, parsed.data.execution_attempt_id!),
          eq(service_execution_attempts.state, 'accepted'),
          gt(service_execution_attempts.lease_expires_at, now)))
        .returning({ id: service_execution_attempts.id })
      if (!completed) throw new DeliveryError('Execution attempt expired before delivery', 409)
    }
    const [updated] = await tx.update(trades).set({ status: 'pending_release', auto_confirm_at: linkedService?.execution_contract_json != null && policy.data.acceptance ? null : new Date(Date.now() + 86400000).toISOString() })
      .where(and(eq(trades.id, tradeId), eq(trades.status, 'escrow_held'))).returning()
    if (!updated) throw new DeliveryError('Trade is not awaiting delivery', 409)
    await advanceServiceOrder(tx, tradeId, 'verifying')
    const [delivery] = await tx.insert(trade_deliveries).values({
      trade_id: tradeId, submitter_id: sellerId, summary: parsed.data.summary,
      delivery_url: parsed.data.delivery_url ?? null,
      artifact_json: parsed.data.artifact ? JSON.stringify(parsed.data.artifact) : null,
      content_hash: contentHash, verification: JSON.stringify(verification),
    }).returning()
    for (const { row } of fresh) await tx.update(private_artifacts).set({ delivery_id: delivery.id }).where(eq(private_artifacts.id, row.id))
    for (const row of evidenceRows(outcomes, delivery.id)) await tx.insert(verification_results).values(row).onConflictDoUpdate({
      target: [verification_results.trade_id, verification_results.content_hash, verification_results.method, verification_results.version],
      set: { delivery_id: delivery.id, evidence_json: row.evidence_json, updated_at: new Date() },
      setWhere: and(isNull(verification_results.delivery_id), eq(verification_results.status, 'passed'), eq(verification_results.status, row.status)),
    })
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
      await recordIntegrityFailure(error)
      if (error instanceof RequiredCheckFailure) await recordFailure(error.assessment)
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
