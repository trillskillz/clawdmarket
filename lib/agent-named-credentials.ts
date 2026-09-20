import crypto from 'node:crypto'
import { db } from '@/lib/db'
import {
  AGENT_CREDENTIAL_SCOPES,
  normalizeAgentCredentialScopes,
  type AgentCredentialScope,
} from '@/lib/agent-credential-scopes'
import { agentApiKeyPrefix, generateAgentApiKey, hashAgentApiKey } from '@/lib/registered-agent-auth'

export const MAX_ACTIVE_NAMED_AGENT_CREDENTIALS = 10

function isDatabaseBusy(error: unknown) {
  return error instanceof Error && (
    ('code' in error && String(error.code) === 'SQLITE_BUSY')
    || error.message.includes('SQLITE_BUSY')
    || error.message.includes('database is locked')
  )
}

export async function listAgentCredentials(agentId: string) {
  const primary = await db.$client.execute({
    sql: `SELECT api_key_prefix, api_key_last_used_at, api_key_rotated_at, created_at
          FROM agents WHERE id = ? LIMIT 1`,
    args: [agentId],
  })
  const named = await db.$client.execute({
    sql: `SELECT id, name, key_prefix, scopes, created_at, last_used_at, expires_at,
                 revoked_at, revoked_by_type, revoked_by_id, revocation_reason
          FROM agent_credentials
          WHERE agent_id = ?
          ORDER BY created_at DESC`,
    args: [agentId],
  })
  const row = primary.rows[0]
  return {
    primary: row ? {
      id: 'primary',
      name: 'Primary',
      prefix: row.api_key_prefix || null,
      scopes: [...AGENT_CREDENTIAL_SCOPES],
      created_at: row.created_at || null,
      last_used_at: row.api_key_last_used_at || null,
      rotated_at: row.api_key_rotated_at || null,
      revoked_at: null,
    } : null,
    named: named.rows.map((credential) => ({
      id: String(credential.id),
      name: String(credential.name),
      prefix: String(credential.key_prefix),
      scopes: (() => {
        try { return JSON.parse(String(credential.scopes || '[]')) }
        catch { return [] }
      })(),
      created_at: credential.created_at,
      last_used_at: credential.last_used_at || null,
      expires_at: credential.expires_at || null,
      revoked_at: credential.revoked_at || null,
      revoked_by_type: credential.revoked_by_type || null,
      revoked_by_id: credential.revoked_by_id || null,
      revocation_reason: credential.revocation_reason || null,
    })),
  }
}

export type CreateNamedAgentCredentialResult =
  | {
      kind: 'created'
      id: string
      api_key: string
      name: string
      prefix: string
      scopes: AgentCredentialScope[]
      created_at: string
      expires_at: string | null
    }
  | { kind: 'conflict' }

export async function createNamedAgentCredential(input: {
  agentId: string
  name: string
  scopes: AgentCredentialScope[]
  expiresInDays?: number
  actorCredentialId: string | null
}): Promise<CreateNamedAgentCredentialResult> {
  const id = `agc_${crypto.randomUUID()}`
  const apiKey = generateAgentApiKey()
  const keyHash = hashAgentApiKey(apiKey)
  const prefix = agentApiKeyPrefix(apiKey)
  const scopes = normalizeAgentCredentialScopes(input.scopes)
  const now = new Date()
  const nowEpoch = Math.floor(now.getTime() / 1000)
  const expiresAt = input.expiresInDays
    ? new Date(now.getTime() + input.expiresInDays * 86_400_000)
    : null
  const expiresAtEpoch = expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null
  const actorId = input.actorCredentialId || input.agentId

  try {
    const [created] = await db.$client.batch([
      {
        sql: `INSERT INTO agent_credentials (
                id, agent_id, name, key_hash, key_prefix, scopes, created_by_type,
                created_by_id, created_at, expires_at
              )
              SELECT ?, ?, ?, ?, ?, ?, 'credential', ?, ?, ?
              WHERE (
                SELECT COUNT(*) FROM agent_credentials
                WHERE agent_id = ? AND revoked_at IS NULL
                  AND (expires_at IS NULL OR expires_at > ?)
              ) < ?
              AND NOT EXISTS (
                SELECT 1 FROM agent_credentials
                WHERE agent_id = ? AND LOWER(name) = LOWER(?) AND revoked_at IS NULL
                  AND (expires_at IS NULL OR expires_at > ?)
              )`,
        args: [
          id,
          input.agentId,
          input.name,
          keyHash,
          prefix,
          JSON.stringify(scopes),
          actorId,
          nowEpoch,
          expiresAtEpoch,
          input.agentId,
          nowEpoch,
          MAX_ACTIVE_NAMED_AGENT_CREDENTIALS,
          input.agentId,
          input.name,
          nowEpoch,
        ],
      },
      {
        sql: `INSERT INTO agent_lifecycle_events (
                id, agent_id, action, actor_type, actor_id, reason, metadata, created_at
              )
              SELECT ?, ?, 'credential_created', 'credential', ?, 'Named agent credential created', ?, ?
              WHERE changes() > 0`,
        args: [
          `ale_${crypto.randomUUID()}`,
          input.agentId,
          actorId,
          JSON.stringify({ credential_id: id, name: input.name, prefix, scopes, expires_at: expiresAt?.toISOString() || null }),
          nowEpoch,
        ],
      },
    ], 'write')
    if (created.rowsAffected !== 1) return { kind: 'conflict' }
  } catch (error) {
    if (isDatabaseBusy(error)) return { kind: 'conflict' }
    throw error
  }

  return {
    kind: 'created',
    id,
    api_key: apiKey,
    name: input.name,
    prefix,
    scopes,
    created_at: now.toISOString(),
    expires_at: expiresAt?.toISOString() || null,
  }
}

export type RevokeNamedAgentCredentialResult =
  | { kind: 'revoked'; revoked_at: string }
  | { kind: 'already_revoked'; revoked_at: string | null }
  | { kind: 'not_found' }
  | { kind: 'conflict' }

export async function revokeNamedAgentCredential(input: {
  agentId: string
  credentialId: string
  actorCredentialId: string | null
  reason: string
}): Promise<RevokeNamedAgentCredentialResult> {
  const existing = await db.$client.execute({
    sql: `SELECT id, name, key_prefix, revoked_at FROM agent_credentials
          WHERE id = ? AND agent_id = ? LIMIT 1`,
    args: [input.credentialId, input.agentId],
  })
  const credential = existing.rows[0]
  if (!credential) return { kind: 'not_found' }
  if (credential.revoked_at) {
    return {
      kind: 'already_revoked',
      revoked_at: new Date(Number(credential.revoked_at) * 1000).toISOString(),
    }
  }

  const now = new Date()
  const nowEpoch = Math.floor(now.getTime() / 1000)
  const actorId = input.actorCredentialId || input.agentId
  try {
    const [revoked] = await db.$client.batch([
      {
        sql: `UPDATE agent_credentials
              SET revoked_at = ?, revoked_by_type = 'credential', revoked_by_id = ?, revocation_reason = ?
              WHERE id = ? AND agent_id = ? AND revoked_at IS NULL`,
        args: [nowEpoch, actorId, input.reason, input.credentialId, input.agentId],
      },
      {
        sql: `INSERT INTO agent_lifecycle_events (
                id, agent_id, action, actor_type, actor_id, reason, metadata, created_at
              )
              SELECT ?, ?, 'credential_revoked', 'credential', ?, ?, ?, ?
              WHERE changes() > 0`,
        args: [
          `ale_${crypto.randomUUID()}`,
          input.agentId,
          actorId,
          input.reason,
          JSON.stringify({ credential_id: input.credentialId, name: credential.name, prefix: credential.key_prefix }),
          nowEpoch,
        ],
      },
    ], 'write')
    if (revoked.rowsAffected !== 1) return { kind: 'conflict' }
  } catch (error) {
    if (isDatabaseBusy(error)) return { kind: 'conflict' }
    throw error
  }
  return { kind: 'revoked', revoked_at: now.toISOString() }
}
