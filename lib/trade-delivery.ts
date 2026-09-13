import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { messages, task_workspaces, trade_deliveries, trades } from './schema'
import { encryptMessage } from './chat-crypto'
import { deliverySchema, requirementsSchema, verifyDelivery } from './delivery-validation'
import { deliverWebhookEvent } from './webhook-delivery'

export class DeliveryError extends Error {
  constructor(message: string, public status: number, public details?: unknown) { super(message) }
}

export async function submitTradeDelivery(tradeId: string, sellerId: string, input: unknown, expectedBuyerId?: string) {
  const parsed = deliverySchema.safeParse(input)
  if (!parsed.success) throw new DeliveryError('Invalid delivery', 400, parsed.error.issues)
  const serialized = JSON.stringify(parsed.data)
  if (Buffer.byteLength(serialized, 'utf8') > 50_000) throw new DeliveryError('Delivery exceeds 50 KB', 413)
  const [trade] = await db.select().from(trades).where(eq(trades.id, tradeId)).limit(1)
  if (!trade) throw new DeliveryError('Trade not found', 404)
  if (trade.seller_id !== sellerId) throw new DeliveryError('Only the seller can submit delivery', 403)
  if (expectedBuyerId && expectedBuyerId !== trade.buyer_id) throw new DeliveryError('Delivery must be addressed to the trade buyer', 403)
  const [workspace] = await db.select().from(task_workspaces).where(eq(task_workspaces.trade_id, tradeId)).limit(1)
  const requirements = requirementsSchema.parse(workspace ? {
    ...workspace,
    acceptance_criteria: JSON.parse(workspace.acceptance_criteria),
    required_json_keys: JSON.parse(workspace.required_json_keys),
  } : {})
  const verification = verifyDelivery(parsed.data, requirements)
  if (verification.status === 'failed') throw new DeliveryError('Delivery does not meet the required structure', 422, verification)
  const contentHash = createHash('sha256').update(serialized).digest('hex')
  const encrypted = await encryptMessage(JSON.stringify({ type: 'task_complete', trade_id: tradeId, ...parsed.data, content_hash: contentHash }))
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx.update(trades).set({ status: 'pending_release', auto_confirm_at: new Date(Date.now() + 86400000).toISOString() })
      .where(and(eq(trades.id, tradeId), eq(trades.status, 'escrow_held'))).returning()
    if (!updated) throw new DeliveryError('Trade is not awaiting delivery', 409)
    const [delivery] = await tx.insert(trade_deliveries).values({
      trade_id: tradeId, submitter_id: sellerId, summary: parsed.data.summary,
      delivery_url: parsed.data.delivery_url ?? null,
      artifact_json: parsed.data.artifact ? JSON.stringify(parsed.data.artifact) : null,
      content_hash: contentHash, verification: JSON.stringify(verification),
    }).returning()
    const [message] = await tx.insert(messages).values({
      sender_id: sellerId, receiver_id: trade.buyer_id,
      encrypted_content: encrypted.encrypted_content, nonce: encrypted.nonce,
    }).returning()
    return { delivery, message, trade: updated, verification }
  })
  await Promise.allSettled([
    deliverWebhookEvent(trade.buyer_id, 'message.received', { message_id: result.message.id, from_agent_id: sellerId, type: 'task_complete', trade_id: tradeId }),
    deliverWebhookEvent(trade.buyer_id, 'trade.status_changed', { trade_id: tradeId, new_status: 'pending_release' }),
    deliverWebhookEvent(sellerId, 'trade.status_changed', { trade_id: tradeId, new_status: 'pending_release' }),
  ])
  return result
}
