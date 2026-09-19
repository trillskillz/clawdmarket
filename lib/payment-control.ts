import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { payment_control_events, payment_controls } from '@/lib/schema'

export const NEW_PAYMENTS_CONTROL_KEY = 'new_payments'
export const NEW_PAYMENTS_PAUSED_MESSAGE = 'New marketplace payments are temporarily paused. Existing payments and refunds can still be recovered.'

export type NewPaymentControl = { paused: boolean; reason: string | null; source: 'database' | 'environment' }

export async function getNewPaymentControl(): Promise<NewPaymentControl> {
  // An environment override remains available if the admin UI is unreachable.
  // The database is still read so schema drift fails closed on payment starts.
  const [row] = await db.select().from(payment_controls)
    .where(eq(payment_controls.key, NEW_PAYMENTS_CONTROL_KEY)).limit(1)
  if (process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED === 'true') {
    return { paused: true, reason: 'New payments are temporarily paused by the operator.', source: 'environment' }
  }
  return { paused: row?.paused === 1, reason: row?.paused ? row.reason || 'New payments are temporarily paused.' : null, source: 'database' }
}

export class NewPaymentsPausedError extends Error {
  readonly code = 'NEW_PAYMENTS_PAUSED'
  readonly status = 503
  constructor() {
    super(NEW_PAYMENTS_PAUSED_MESSAGE)
  }
}

export async function requireNewPaymentsOpen() {
  const control = await getNewPaymentControl()
  if (control.paused) throw new NewPaymentsPausedError()
}

export async function setNewPaymentControl(input: { paused: boolean; reason: string; actorUserId: string }) {
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(payment_controls).values({
      key: NEW_PAYMENTS_CONTROL_KEY, paused: input.paused ? 1 : 0,
      reason: input.reason, updated_by: input.actorUserId, updated_at: now,
    }).onConflictDoUpdate({ target: payment_controls.key, set: {
      paused: input.paused ? 1 : 0, reason: input.reason,
      updated_by: input.actorUserId, updated_at: now,
    } })
    await tx.insert(payment_control_events).values({
      control_key: NEW_PAYMENTS_CONTROL_KEY, paused: input.paused ? 1 : 0,
      reason: input.reason, actor_user_id: input.actorUserId, created_at: now,
    })
  })
  return getNewPaymentControl()
}

export async function getNewPaymentControlEvents(limit = 25) {
  const result = await db.$client.execute({
    sql: 'SELECT id, paused, reason, actor_user_id, created_at FROM payment_control_events WHERE control_key = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    args: [NEW_PAYMENTS_CONTROL_KEY, Math.max(1, Math.min(100, limit))],
  })
  return result.rows
}
