import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  reference_fleet_control_events,
  reference_fleet_controls,
} from '@/lib/schema'
import { REFERENCE_FLEET_MARKER } from '@/lib/reference-fleet-manifest'

export const REFERENCE_FLEET_EXECUTION_CONTROL_KEY = 'delivery_execution'

export type ReferenceFleetExecutionControl = {
  paused: boolean
  reason: string | null
  source: 'database' | 'default' | 'environment'
}

export async function getReferenceFleetExecutionControl(): Promise<ReferenceFleetExecutionControl> {
  const [row] = await db.select().from(reference_fleet_controls)
    .where(eq(reference_fleet_controls.key, REFERENCE_FLEET_EXECUTION_CONTROL_KEY)).limit(1)
  if (process.env.CLAWDMARKET_REFERENCE_FLEET_EXECUTION_PAUSED === 'true') {
    return {
      paused: true,
      reason: 'Managed capability execution is paused by the operator environment override.',
      source: 'environment',
    }
  }
  if (!row) {
    return {
      paused: true,
      reason: 'Managed capability execution remains paused until an operator enables it.',
      source: 'default',
    }
  }
  return {
    paused: row.paused === 1,
    reason: row.reason || null,
    source: 'database',
  }
}

export async function setReferenceFleetExecutionControl(input: {
  paused: boolean
  reason: string
  actorUserId: string
}) {
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(reference_fleet_controls).values({
      key: REFERENCE_FLEET_EXECUTION_CONTROL_KEY,
      paused: input.paused ? 1 : 0,
      reason: input.reason,
      updated_by: input.actorUserId,
      updated_at: now,
    }).onConflictDoUpdate({
      target: reference_fleet_controls.key,
      set: {
        paused: input.paused ? 1 : 0,
        reason: input.reason,
        updated_by: input.actorUserId,
        updated_at: now,
      },
    })
    await tx.insert(reference_fleet_control_events).values({
      control_key: REFERENCE_FLEET_EXECUTION_CONTROL_KEY,
      paused: input.paused ? 1 : 0,
      reason: input.reason,
      actor_user_id: input.actorUserId,
      created_at: now,
    })
  })
  return getReferenceFleetExecutionControl()
}

export async function getReferenceFleetExecutionControlEvents(limit = 25) {
  const result = await db.$client.execute({
    sql: `SELECT id, paused, reason, actor_user_id, created_at
          FROM reference_fleet_control_events
          WHERE control_key = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    args: [REFERENCE_FLEET_EXECUTION_CONTROL_KEY, Math.max(1, Math.min(100, limit))],
  })
  return result.rows
}

export async function isReferenceFleetAgent(agentId: string | null) {
  if (!agentId) return false
  const result = await db.$client.execute({
    sql: 'SELECT 1 FROM agents WHERE id = ? AND INSTR(description, ?) > 0 LIMIT 1',
    args: [agentId, REFERENCE_FLEET_MARKER],
  })
  return result.rows.length === 1
}

/**
 * Paid catalog publication is deliberately locked in this phase. Funded,
 * task-backed work can be canaried without exposing an unproven service to
 * buyers. A later release must replace this with a health-backed enablement.
 */
export async function referenceFleetPaidServicePublicationLocked(agentId: string | null) {
  return isReferenceFleetAgent(agentId)
}
