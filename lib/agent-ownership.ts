import crypto from 'node:crypto'
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { generateAgentApiKey, hashAgentApiKey } from '@/lib/registered-agent-auth'
import {
  agent_credentials,
  agent_lifecycle_events,
  agent_owners,
  agent_ownership_transfers,
  agents,
} from '@/lib/schema'

export const OWNERSHIP_TRANSFER_TTL_SECONDS = 24 * 60 * 60

function transferTokenHash(token: string) {
  return hashAgentApiKey(`ownership-transfer:${token}`)
}

function isDatabaseBusy(error: unknown) {
  return error instanceof Error && (
    ('code' in error && String(error.code) === 'SQLITE_BUSY')
    || error.message.includes('SQLITE_BUSY')
    || error.message.includes('database is locked')
  )
}

export async function listOwnedAgents(userId: string) {
  const result = await db.$client.execute({
    sql: `SELECT a.id, a.name, a.status, a.visibility, a.owner_email, a.owner_address,
                 o.established_by, o.established_at, o.updated_at
          FROM agent_owners o
          JOIN agents a ON a.id = o.agent_id
          WHERE o.user_id = ? AND a.archived_at IS NULL
          ORDER BY o.updated_at DESC`,
    args: [userId],
  })
  return result.rows.map((row) => ({
    agent_id: String(row.id),
    name: String(row.name),
    status: String(row.status),
    visibility: String(row.visibility || 'public'),
    owner_email: row.owner_email || null,
    owner_address: row.owner_address || null,
    established_by: String(row.established_by),
    established_at: row.established_at,
    updated_at: row.updated_at,
  }))
}

export async function linkAgentOwner(input: {
  agentId: string
  userId: string
  establishedBy: string
}) {
  const now = new Date()
  const nowEpoch = Math.floor(now.getTime() / 1000)
  try {
    const [linked] = await db.$client.batch([
      {
        sql: `INSERT INTO agent_owners (agent_id, user_id, established_by, established_at, updated_at)
              SELECT id, ?, ?, ?, ? FROM agents
              WHERE id = ? AND status = 'active' AND archived_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM agent_owners WHERE agent_id = ?)`,
        args: [input.userId, input.establishedBy, nowEpoch, nowEpoch, input.agentId, input.agentId],
      },
      {
        sql: `INSERT INTO agent_lifecycle_events (
                id, agent_id, action, actor_type, actor_id, reason, metadata, created_at
              )
              SELECT ?, ?, 'ownership_linked', 'owner', ?, 'Human recovery owner linked', '{}', ?
              WHERE changes() > 0`,
        args: [`ale_${crypto.randomUUID()}`, input.agentId, input.userId, nowEpoch],
      },
    ], 'write')
    return linked.rowsAffected === 1 ? { kind: 'linked' as const, linked_at: now.toISOString() } : { kind: 'conflict' as const }
  } catch (error) {
    if (isDatabaseBusy(error)) return { kind: 'conflict' as const }
    throw error
  }
}

export async function recoverAgentCredentials(input: { agentId: string; ownerUserId: string }) {
  const apiKey = generateAgentApiKey()
  const digest = hashAgentApiKey(apiKey)
  const prefix = apiKey.slice(0, 12)
  const now = new Date()
  const nowEpoch = Math.floor(now.getTime() / 1000)
  try {
    const [recovered, revokedNamed] = await db.$client.batch([
      {
        sql: `UPDATE agents
              SET api_key = ?, api_key_prefix = ?, api_key_last_used_at = NULL,
                  api_key_rotated_at = ?, api_key_revoked_at = NULL,
                  previous_api_key = NULL, previous_api_key_prefix = NULL,
                  previous_api_key_expires_at = NULL
              WHERE id = ? AND status = 'active' AND archived_at IS NULL
                AND EXISTS (
                  SELECT 1 FROM agent_owners WHERE agent_id = ? AND user_id = ?
                )`,
        args: [digest, prefix, nowEpoch, input.agentId, input.agentId, input.ownerUserId],
      },
      {
        sql: `UPDATE agent_credentials
              SET revoked_at = ?, revoked_by_type = 'owner', revoked_by_id = ?,
                  revocation_reason = 'Owner-assisted credential recovery'
              WHERE agent_id = ? AND revoked_at IS NULL
                AND EXISTS (SELECT 1 FROM agents WHERE id = ? AND api_key = ?)`,
        args: [nowEpoch, input.ownerUserId, input.agentId, input.agentId, digest],
      },
      {
        sql: `INSERT INTO agent_lifecycle_events (
                id, agent_id, action, actor_type, actor_id, reason, metadata, created_at
              )
              SELECT ?, ?, 'credential_recovered', 'owner', ?,
                     'Owner-assisted credential recovery', ?, ?
              WHERE EXISTS (SELECT 1 FROM agents WHERE id = ? AND api_key = ?)`,
        args: [
          `ale_${crypto.randomUUID()}`,
          input.agentId,
          input.ownerUserId,
          JSON.stringify({ new_prefix: prefix, named_credentials_revoked: true }),
          nowEpoch,
          input.agentId,
          digest,
        ],
      },
    ], 'write')
    if (recovered.rowsAffected !== 1) return { kind: 'forbidden' as const }
    return {
      kind: 'recovered' as const,
      api_key: apiKey,
      prefix,
      recovered_at: now.toISOString(),
      named_credentials_revoked: revokedNamed.rowsAffected,
    }
  } catch (error) {
    if (isDatabaseBusy(error)) return { kind: 'conflict' as const }
    throw error
  }
}

export async function createOwnershipTransfer(input: {
  agentId: string
  ownerUserId: string
  targetType: 'email' | 'wallet'
  targetValue: string
}) {
  const id = `aot_${crypto.randomUUID()}`
  const token = `clawd_transfer_${crypto.randomBytes(32).toString('hex')}`
  const tokenHash = transferTokenHash(token)
  const now = new Date()
  const nowEpoch = Math.floor(now.getTime() / 1000)
  const expiresAt = new Date(now.getTime() + OWNERSHIP_TRANSFER_TTL_SECONDS * 1000)
  const expiresAtEpoch = Math.floor(expiresAt.getTime() / 1000)
  try {
    const [created] = await db.$client.batch([
      {
        sql: `INSERT INTO agent_ownership_transfers (
                id, agent_id, from_user_id, target_type, target_value,
                token_hash, expires_at, created_at
              )
              SELECT ?, ?, ?, ?, ?, ?, ?, ?
              WHERE EXISTS (
                SELECT 1 FROM agent_owners WHERE agent_id = ? AND user_id = ?
              ) AND EXISTS (
                SELECT 1 FROM agents WHERE id = ? AND status = 'active' AND archived_at IS NULL
              )`,
        args: [
          id,
          input.agentId,
          input.ownerUserId,
          input.targetType,
          input.targetValue,
          tokenHash,
          expiresAtEpoch,
          nowEpoch,
          input.agentId,
          input.ownerUserId,
          input.agentId,
        ],
      },
      {
        sql: `UPDATE agent_ownership_transfers
              SET cancelled_at = ?
              WHERE agent_id = ? AND id <> ? AND accepted_at IS NULL AND cancelled_at IS NULL
                AND EXISTS (SELECT 1 FROM agent_ownership_transfers WHERE id = ?)`,
        args: [nowEpoch, input.agentId, id, id],
      },
      {
        sql: `INSERT INTO agent_lifecycle_events (
                id, agent_id, action, actor_type, actor_id, reason, metadata, created_at
              )
              SELECT ?, ?, 'ownership_transfer_requested', 'owner', ?,
                     'Ownership transfer requested', ?, ?
              WHERE EXISTS (SELECT 1 FROM agent_ownership_transfers WHERE id = ?)`,
        args: [
          `ale_${crypto.randomUUID()}`,
          input.agentId,
          input.ownerUserId,
          JSON.stringify({ transfer_id: id, target_type: input.targetType, target_value: input.targetValue, expires_at: expiresAt.toISOString() }),
          nowEpoch,
          id,
        ],
      },
    ], 'write')
    if (created.rowsAffected !== 1) return { kind: 'forbidden' as const }
  } catch (error) {
    if (isDatabaseBusy(error)) return { kind: 'conflict' as const }
    throw error
  }
  return {
    kind: 'created' as const,
    id,
    token,
    target_type: input.targetType,
    target_value: input.targetValue,
    expires_at: expiresAt.toISOString(),
  }
}

export async function findOwnershipTransfer(token: string) {
  const result = await db.$client.execute({
    sql: `SELECT id, agent_id, from_user_id, target_type, target_value, expires_at,
                 accepted_at, cancelled_at
          FROM agent_ownership_transfers WHERE token_hash = ? LIMIT 1`,
    args: [transferTokenHash(token)],
  })
  const row = result.rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    fromUserId: String(row.from_user_id),
    targetType: String(row.target_type) as 'email' | 'wallet',
    targetValue: String(row.target_value),
    expiresAt: Number(row.expires_at),
    acceptedAt: row.accepted_at ? Number(row.accepted_at) : null,
    cancelledAt: row.cancelled_at ? Number(row.cancelled_at) : null,
  }
}

export async function acceptOwnershipTransfer(input: {
  token: string
  transferId: string
  agentId: string
  acceptingUserId: string
  targetType: 'email' | 'wallet'
  targetValue: string
}) {
  const apiKey = generateAgentApiKey()
  const digest = hashAgentApiKey(apiKey)
  const prefix = apiKey.slice(0, 12)
  const tokenHash = transferTokenHash(input.token)
  const now = new Date()
  const newOwnerEmail = input.targetType === 'email' ? input.targetValue : null
  const newOwnerAddress = input.targetType === 'wallet' ? input.targetValue : ''

  try {
    const result = await db.transaction(async (tx) => {
      const [accepted] = await tx.update(agent_ownership_transfers).set({
        acceptedAt: now,
        acceptedByUserId: input.acceptingUserId,
      }).where(and(
        eq(agent_ownership_transfers.id, input.transferId),
        eq(agent_ownership_transfers.tokenHash, tokenHash),
        eq(agent_ownership_transfers.agentId, input.agentId),
        eq(agent_ownership_transfers.targetType, input.targetType),
        eq(agent_ownership_transfers.targetValue, input.targetValue),
        isNull(agent_ownership_transfers.acceptedAt),
        isNull(agent_ownership_transfers.cancelledAt),
        gt(agent_ownership_transfers.expiresAt, now),
        sql`EXISTS (
          SELECT 1 FROM ${agent_owners}
          WHERE ${agent_owners.agentId} = ${input.agentId}
            AND ${agent_owners.userId} = ${agent_ownership_transfers.fromUserId}
        )`,
        sql`EXISTS (
          SELECT 1 FROM ${agents}
          WHERE ${agents.id} = ${input.agentId}
            AND ${agents.status} = 'active'
            AND ${agents.archivedAt} IS NULL
        )`,
      )).returning({ id: agent_ownership_transfers.id })
      if (!accepted) return { kind: 'conflict' as const }

      const [ownerUpdated] = await tx.update(agent_owners).set({
        userId: input.acceptingUserId,
        updatedAt: now,
      }).where(and(
        eq(agent_owners.agentId, input.agentId),
        eq(agent_owners.userId, sql`(
          SELECT from_user_id FROM agent_ownership_transfers WHERE id = ${input.transferId}
        )`),
      )).returning({ agentId: agent_owners.agentId })
      const [agentUpdated] = await tx.update(agents).set({
        owner_email: newOwnerEmail,
        owner_address: newOwnerAddress,
        api_key: digest,
        apiKeyPrefix: prefix,
        apiKeyLastUsedAt: null,
        apiKeyRotatedAt: now,
        apiKeyRevokedAt: null,
        previousApiKey: null,
        previousApiKeyPrefix: null,
        previousApiKeyExpiresAt: null,
      }).where(and(
        eq(agents.id, input.agentId),
        eq(agents.status, 'active'),
        isNull(agents.archivedAt),
      )).returning({ id: agents.id })
      if (!ownerUpdated || !agentUpdated) throw new Error('ownership_transfer_state_changed')

      const revokedNamed = await tx.update(agent_credentials).set({
        revokedAt: now,
        revokedByType: 'owner',
        revokedById: input.acceptingUserId,
        revocationReason: 'Ownership transferred',
      }).where(and(
        eq(agent_credentials.agentId, input.agentId),
        isNull(agent_credentials.revokedAt),
      )).returning({ id: agent_credentials.id })

      await tx.update(agent_ownership_transfers).set({ cancelledAt: now }).where(and(
        eq(agent_ownership_transfers.agentId, input.agentId),
        ne(agent_ownership_transfers.id, input.transferId),
        isNull(agent_ownership_transfers.acceptedAt),
        isNull(agent_ownership_transfers.cancelledAt),
      ))
      await tx.insert(agent_lifecycle_events).values({
        id: `ale_${crypto.randomUUID()}`,
        agent_id: input.agentId,
        action: 'ownership_transferred',
        actor_type: 'owner',
        actor_id: input.acceptingUserId,
        reason: 'Ownership transfer accepted',
        metadata: JSON.stringify({
          transfer_id: input.transferId,
          new_owner_type: input.targetType,
          credentials_revoked: true,
        }),
        created_at: now,
      })
      return { kind: 'accepted' as const, namedCredentialsRevoked: revokedNamed.length }
    })
    if (result.kind === 'conflict') return result
    return {
      kind: 'accepted' as const,
      agent_id: input.agentId,
      api_key: apiKey,
      prefix,
      accepted_at: now.toISOString(),
      named_credentials_revoked: result.namedCredentialsRevoked,
    }
  } catch (error) {
    if (isDatabaseBusy(error) || (error instanceof Error && error.message === 'ownership_transfer_state_changed')) {
      return { kind: 'conflict' as const }
    }
    throw error
  }
}

export async function cancelOwnershipTransfer(input: {
  agentId: string
  transferId: string
  ownerUserId: string
}) {
  const now = new Date()
  const nowEpoch = Math.floor(now.getTime() / 1000)
  const [cancelled] = await db.$client.batch([
    {
      sql: `UPDATE agent_ownership_transfers
            SET cancelled_at = ?
            WHERE id = ? AND agent_id = ? AND accepted_at IS NULL AND cancelled_at IS NULL
              AND EXISTS (SELECT 1 FROM agent_owners WHERE agent_id = ? AND user_id = ?)`,
      args: [nowEpoch, input.transferId, input.agentId, input.agentId, input.ownerUserId],
    },
    {
      sql: `INSERT INTO agent_lifecycle_events (
              id, agent_id, action, actor_type, actor_id, reason, metadata, created_at
            )
            SELECT ?, ?, 'ownership_transfer_cancelled', 'owner', ?,
                   'Ownership transfer cancelled', ?, ?
            WHERE changes() > 0`,
      args: [
        `ale_${crypto.randomUUID()}`,
        input.agentId,
        input.ownerUserId,
        JSON.stringify({ transfer_id: input.transferId }),
        nowEpoch,
      ],
    },
  ], 'write')
  return cancelled.rowsAffected === 1 ? { kind: 'cancelled' as const } : { kind: 'not_found' as const }
}
