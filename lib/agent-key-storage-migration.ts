import crypto from 'crypto'
import { agentApiKeyPrefix, hashAgentApiKey } from '@/lib/registered-agent-auth'

/**
 * One-time, idempotent conversion of plaintext primary agent API keys to the
 * keyed HMAC used by runtime authentication. Runs during the Deploy workflow
 * after the additive runtime schema migration.
 *
 * Classification uses only stored shape, never key material:
 * - plaintext: a non-empty api_key that is not 64 lowercase hex characters.
 * - unprefixed_digest: 64-hex with no api_key_prefix (excluding the release
 *   monitor, whose row is written by sync-release-monitor without a prefix).
 *   Every registration since the HMAC release sets a prefix, so these are the
 *   rows that may still hold an unkeyed SHA-256 digest from 2026-09-12..19.
 *   They cannot be converted without the key and are only reported.
 *
 * Fail-safe: nothing is written unless a pepper is configured and the release
 * monitor row proves that pepper is the one production already uses. Each row
 * is converted with a conditional UPDATE plus its audit event in one atomic
 * batch, so a failure never leaves a half-converted row.
 */

export const RELEASE_MONITOR_AGENT_ID = 'agent_clawdmarket_release_monitor'

const HEX64_SQL = `(length(api_key) = 64 AND api_key NOT GLOB '*[^0-9a-f]*')`
const PLAINTEXT_SQL = `(api_key IS NOT NULL AND api_key <> '' AND NOT ${HEX64_SQL})`
const UNPREFIXED_DIGEST_SQL = `(${HEX64_SQL} AND api_key_prefix IS NULL AND id <> '${RELEASE_MONITOR_AGENT_ID}')`

type SqlClient = {
  execute(statement: string | { sql: string; args: unknown[] }): Promise<{ rows: Array<Record<string, unknown>>; rowsAffected?: number }>
  batch(statements: Array<{ sql: string; args: unknown[] }>, mode?: 'write'): Promise<Array<{ rowsAffected?: number }>>
}

export type AgentKeyStorageCounts = {
  total_with_key: number
  plaintext: number
  unprefixed_digest: number
}

export type PepperProof = 'match' | 'mismatch' | 'unavailable'

export type AgentKeyStorageUpgradeResult = {
  before: AgentKeyStorageCounts
  after: AgentKeyStorageCounts
  converted: number
  pepper_proof: PepperProof | 'not_needed'
  report_only: boolean
}

export class AgentKeyStorageUpgradeError extends Error {
  constructor(readonly code: 'pepper_missing' | 'pepper_unverified' | 'pepper_mismatch' | 'plaintext_remaining', message: string) {
    super(message)
  }
}

export async function countAgentKeyStorage(client: SqlClient): Promise<AgentKeyStorageCounts> {
  const result = await client.execute(`SELECT
      SUM(CASE WHEN api_key IS NOT NULL AND api_key <> '' THEN 1 ELSE 0 END) AS total_with_key,
      SUM(CASE WHEN ${PLAINTEXT_SQL} THEN 1 ELSE 0 END) AS plaintext,
      SUM(CASE WHEN ${UNPREFIXED_DIGEST_SQL} THEN 1 ELSE 0 END) AS unprefixed_digest
    FROM agents`)
  const row = result.rows[0] || {}
  return {
    total_with_key: Number(row.total_with_key || 0),
    plaintext: Number(row.plaintext || 0),
    unprefixed_digest: Number(row.unprefixed_digest || 0),
  }
}

function constantTimeEqual(stored: unknown, candidate: string): boolean {
  if (typeof stored !== 'string') return false
  const a = Buffer.from(stored), b = Buffer.from(candidate)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Proves the configured pepper reproduces the release monitor's stored HMAC. */
export async function proveAgentKeyPepper(client: SqlClient, selfTestApiKey: string | undefined): Promise<PepperProof> {
  if (!selfTestApiKey) return 'unavailable'
  const result = await client.execute({ sql: 'SELECT api_key FROM agents WHERE id = ? LIMIT 1', args: [RELEASE_MONITOR_AGENT_ID] })
  const stored = result.rows[0]?.api_key
  if (typeof stored !== 'string' || !stored) return 'unavailable'
  return constantTimeEqual(stored, hashAgentApiKey(selfTestApiKey)) ? 'match' : 'mismatch'
}

export async function upgradePlaintextAgentApiKeys(
  client: SqlClient,
  options: { pepperConfigured: boolean; selfTestApiKey?: string; reportOnly?: boolean },
): Promise<AgentKeyStorageUpgradeResult> {
  const before = await countAgentKeyStorage(client)
  const reportOnly = Boolean(options.reportOnly)
  if (before.plaintext === 0 || reportOnly) {
    return { before, after: before, converted: 0, pepper_proof: 'not_needed', report_only: reportOnly }
  }
  if (!options.pepperConfigured) {
    throw new AgentKeyStorageUpgradeError('pepper_missing', 'AGENT_API_KEY_PEPPER (or JWT_SECRET) is required to convert plaintext agent keys; nothing was changed')
  }
  const proof = await proveAgentKeyPepper(client, options.selfTestApiKey)
  if (proof === 'mismatch') {
    throw new AgentKeyStorageUpgradeError('pepper_mismatch', 'The configured pepper does not reproduce the release monitor credential; nothing was changed')
  }
  if (proof !== 'match') {
    throw new AgentKeyStorageUpgradeError('pepper_unverified', 'Cannot prove the configured pepper (release monitor row or CLAWDMARKET_SELF_TEST_API_KEY missing); nothing was changed')
  }

  const rows = await client.execute(`SELECT id, api_key FROM agents WHERE ${PLAINTEXT_SQL}`)
  let converted = 0
  for (const row of rows.rows) {
    const id = String(row.id)
    const stored = String(row.api_key)
    const [update] = await client.batch([
      {
        sql: `UPDATE agents SET api_key = ?, api_key_prefix = COALESCE(api_key_prefix, ?)
              WHERE id = ? AND api_key = ?`,
        args: [hashAgentApiKey(stored), agentApiKeyPrefix(stored), id, stored],
      },
      {
        sql: `INSERT INTO agent_lifecycle_events (id, agent_id, action, actor_type, actor_id, reason, metadata, created_at)
              SELECT ?, ?, 'credential_storage_upgraded', 'system', NULL,
                     'Plaintext API key storage converted to keyed HMAC during deploy', ?, unixepoch()
              WHERE changes() = 1`,
        args: [`ale_${crypto.randomUUID()}`, id, JSON.stringify({ from: 'plaintext', to: 'hmac', via: 'deploy_migration' })],
      },
    ], 'write')
    converted += Number(update?.rowsAffected || 0)
  }

  const after = await countAgentKeyStorage(client)
  if (after.plaintext !== 0) {
    throw new AgentKeyStorageUpgradeError('plaintext_remaining', `${after.plaintext} plaintext agent key(s) remain after conversion`)
  }
  return { before, after, converted, pepper_proof: proof, report_only: false }
}
