import crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents } from '@/lib/schema'
import { agentApiKeyPrefix, generateAgentApiKey, hashAgentApiKey } from '@/lib/registered-agent-auth'

export const AGENT_KEY_OVERLAP_SECONDS = 10 * 60

export type RotateAgentCredentialResult =
  | {
      kind: 'rotated'
      api_key: string
      prefix: string
      rotated_at: string
      previous_prefix: string
      previous_valid_until: string
    }
  | { kind: 'overlap_active'; previous_valid_until: string }
  | { kind: 'inactive' }
  | { kind: 'conflict' }
  | { kind: 'not_found' }

function isDatabaseBusy(error: unknown) {
  if (!(error instanceof Error)) return false
  const code = 'code' in error ? String(error.code) : ''
  return code === 'SQLITE_BUSY' || error.message.includes('SQLITE_BUSY') || error.message.includes('database is locked')
}

export async function rotateAgentCredential(input: {
  agentId: string
  currentApiKey: string
}): Promise<RotateAgentCredentialResult> {
  const newApiKey = generateAgentApiKey()
  const newDigest = hashAgentApiKey(newApiKey)
  const currentDigest = hashAgentApiKey(input.currentApiKey)
  const newPrefix = agentApiKeyPrefix(newApiKey)
  const now = new Date()
  const previousValidUntil = new Date(now.getTime() + AGENT_KEY_OVERLAP_SECONDS * 1000)
  const nowEpoch = Math.floor(now.getTime() / 1000)
  const previousValidUntilEpoch = Math.floor(previousValidUntil.getTime() / 1000)

  const [agent] = await db.select({
    id: agents.id,
    status: agents.status,
    archivedAt: agents.archivedAt,
    apiKey: agents.api_key,
    apiKeyPrefix: agents.apiKeyPrefix,
    previousApiKey: agents.previousApiKey,
    previousApiKeyExpiresAt: agents.previousApiKeyExpiresAt,
  }).from(agents).where(eq(agents.id, input.agentId)).limit(1)

  if (!agent) return { kind: 'not_found' }
  if (agent.status !== 'active' || agent.archivedAt) return { kind: 'inactive' }
  if (agent.apiKey !== currentDigest) return { kind: 'conflict' }
  if (agent.previousApiKey && agent.previousApiKeyExpiresAt && agent.previousApiKeyExpiresAt > now) {
    return {
      kind: 'overlap_active',
      previous_valid_until: agent.previousApiKeyExpiresAt.toISOString(),
    }
  }

  const previousPrefix = agent.apiKeyPrefix || agentApiKeyPrefix(input.currentApiKey)
  const metadata = JSON.stringify({
    previous_prefix: previousPrefix,
    new_prefix: newPrefix,
    previous_valid_until: previousValidUntil.toISOString(),
  })

  try {
    const [updated] = await db.$client.batch([
      {
        sql: `UPDATE agents
              SET previous_api_key = api_key,
                  previous_api_key_prefix = ?,
                  previous_api_key_expires_at = ?,
                  api_key = ?,
                  api_key_prefix = ?,
                  api_key_last_used_at = NULL,
                  api_key_rotated_at = ?
              WHERE id = ?
                AND api_key = ?
                AND status = 'active'
                AND archived_at IS NULL
                AND (
                  previous_api_key IS NULL
                  OR previous_api_key_expires_at IS NULL
                  OR previous_api_key_expires_at <= ?
                )`,
        args: [
          previousPrefix,
          previousValidUntilEpoch,
          newDigest,
          newPrefix,
          nowEpoch,
          input.agentId,
          currentDigest,
          nowEpoch,
        ],
      },
      {
        sql: `INSERT INTO agent_lifecycle_events (
                id, agent_id, action, actor_type, actor_id, reason, metadata, created_at
              )
              SELECT ?, ?, 'credential_rotated', 'self', ?, 'Agent API key rotation', ?, ?
              WHERE changes() > 0`,
        args: [`ale_${crypto.randomUUID()}`, input.agentId, input.agentId, metadata, nowEpoch],
      },
    ], 'write')

    if (updated.rowsAffected !== 1) return { kind: 'conflict' }
  } catch (error) {
    // A competing BEGIN IMMEDIATE can briefly lose the local SQLite write lock.
    // Treat that as the same optimistic-concurrency conflict as a zero-row update.
    if (isDatabaseBusy(error)) return { kind: 'conflict' }
    throw error
  }

  return {
    kind: 'rotated',
    api_key: newApiKey,
    prefix: newPrefix,
    rotated_at: now.toISOString(),
    previous_prefix: previousPrefix,
    previous_valid_until: previousValidUntil.toISOString(),
  }
}

export type RevokePreviousCredentialResult =
  | { kind: 'revoked'; previous_prefix: string | null; revoked_at: string }
  | { kind: 'already_revoked' }
  | { kind: 'inactive' }
  | { kind: 'conflict' }
  | { kind: 'not_found' }

export async function revokePreviousAgentCredential(input: {
  agentId: string
  currentApiKey: string
}): Promise<RevokePreviousCredentialResult> {
  const currentDigest = hashAgentApiKey(input.currentApiKey)
  const now = new Date()
  const nowEpoch = Math.floor(now.getTime() / 1000)

  const [agent] = await db.select({
    id: agents.id,
    status: agents.status,
    archivedAt: agents.archivedAt,
    apiKey: agents.api_key,
    previousApiKey: agents.previousApiKey,
    previousApiKeyPrefix: agents.previousApiKeyPrefix,
  }).from(agents).where(eq(agents.id, input.agentId)).limit(1)

  if (!agent) return { kind: 'not_found' }
  if (agent.status !== 'active' || agent.archivedAt) return { kind: 'inactive' }
  if (agent.apiKey !== currentDigest) return { kind: 'conflict' }
  if (!agent.previousApiKey) return { kind: 'already_revoked' }

  try {
    const [updated] = await db.$client.batch([
      {
        sql: `UPDATE agents
              SET previous_api_key = NULL,
                  previous_api_key_prefix = NULL,
                  previous_api_key_expires_at = NULL
              WHERE id = ?
                AND api_key = ?
                AND previous_api_key = ?
                AND status = 'active'
                AND archived_at IS NULL`,
        args: [input.agentId, currentDigest, agent.previousApiKey],
      },
      {
        sql: `INSERT INTO agent_lifecycle_events (
                id, agent_id, action, actor_type, actor_id, reason, metadata, created_at
              )
              SELECT ?, ?, 'credential_previous_revoked', 'self', ?,
                     'Previous API key overlap revoked', ?, ?
              WHERE changes() > 0`,
        args: [
          `ale_${crypto.randomUUID()}`,
          input.agentId,
          input.agentId,
          JSON.stringify({ previous_prefix: agent.previousApiKeyPrefix }),
          nowEpoch,
        ],
      },
    ], 'write')

    if (updated.rowsAffected !== 1) return { kind: 'conflict' }
  } catch (error) {
    if (isDatabaseBusy(error)) return { kind: 'conflict' }
    throw error
  }

  return {
    kind: 'revoked',
    previous_prefix: agent.previousApiKeyPrefix,
    revoked_at: now.toISOString(),
  }
}
