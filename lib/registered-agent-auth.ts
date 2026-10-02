import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AGENT_ACTIVITY_WRITE_INTERVAL_SECONDS } from '@/lib/agent-presence'
import {
  AGENT_CREDENTIAL_SCOPES,
  hasAgentCredentialScope,
  parseAgentCredentialScopes,
  requiredAgentCredentialScope,
  type AgentCredentialScope,
} from '@/lib/agent-credential-scopes'

type AgentAuthNone = { kind: 'none' }
type AgentAuthInvalid = { kind: 'invalid' }
type AgentAuthForbidden = {
  kind: 'forbidden'
  agentId: string
  requiredScope: AgentCredentialScope
}
type AgentAuthValid = {
  kind: 'agent'
  agentId: string
  name: string
  syntheticUserId: string
  status: 'active' | 'inactive'
  credential: 'current' | 'previous' | 'named'
  credentialId: string | null
  credentialName: string
  credentialPrefix: string | null
  credentialLastUsedAt: number | null
  scopes: AgentCredentialScope[]
}

export type RegisteredAgentAuth = AgentAuthNone | AgentAuthInvalid | AgentAuthForbidden | AgentAuthValid

function getAgentApiKeyPepper(): string {
  const pepper = process.env.AGENT_API_KEY_PEPPER?.trim() || process.env.JWT_SECRET?.trim()
  if (pepper) return pepper
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AGENT_API_KEY_PEPPER or JWT_SECRET is required in production')
  }
  return 'clawdmarket-local-agent-api-key-pepper'
}

export function hashAgentApiKey(apiKey: string): string {
  // This is a high-entropy bearer token, not a human password; keyed HMAC is
  // the appropriate deterministic digest for indexed credential lookup.
  // codeql[js/insufficient-password-hash]
  return crypto
    .createHmac('sha256', getAgentApiKeyPepper())
    .update(`agent-api-key:${apiKey}`)
    .digest('hex')
}

export function agentApiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, 12)
}

export function generateAgentApiKey(): string {
  return `clawd_${crypto.randomBytes(24).toString('hex')}`
}

export function registeredAgentApiKeyFromRequest(request: NextRequest): string {
  const headerKey =
    request.headers.get('x-clawdmarket-agent-key') ||
    request.headers.get('x-agent-api-key') ||
    ''
  if (headerKey.trim()) return headerKey.trim()
  const authHeader = request.headers.get('authorization')
  return authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : ''
}

export async function lookupRegisteredAgentApiKey(
  apiKey: string,
  options: { allowInactive?: boolean; requiredScope?: AgentCredentialScope } = {},
): Promise<RegisteredAgentAuth> {
  return resolveRegisteredAgentApiKey(apiKey, Boolean(apiKey), options)
}

async function resolveRegisteredAgentApiKey(
  apiKey: string,
  hasCredential: boolean,
  options: { allowInactive?: boolean; requiredScope?: AgentCredentialScope } = {},
): Promise<RegisteredAgentAuth> {
  if (!hasCredential) return { kind: 'none' }
  if (!apiKey) return { kind: 'invalid' }

  const client = (db as any).$client
  const hashed = hashAgentApiKey(apiKey)
  const primaryResult = await client.execute({
    sql: `SELECT id, name, status, api_key, api_key_prefix, api_key_revoked_at, archived_at,
                 previous_api_key, previous_api_key_prefix, previous_api_key_expires_at
          FROM agents
          WHERE api_key IN (?, ?)
             OR (previous_api_key = ? AND previous_api_key_expires_at > unixepoch())
          LIMIT 1`,
    args: [hashed, apiKey, hashed],
  })
  let agent = primaryResult?.rows?.[0]
  let namedCredential: Record<string, unknown> | null = null
  if (!agent) {
    const namedResult = await client.execute({
      sql: `SELECT a.id, a.name, a.status, a.api_key_revoked_at, a.archived_at,
                   c.id AS credential_id, c.name AS credential_name, c.key_prefix AS credential_prefix, c.scopes,
                   c.expires_at, c.revoked_at
            FROM agent_credentials c
            JOIN agents a ON a.id = c.agent_id
            WHERE c.key_hash = ?
              AND c.revoked_at IS NULL
              AND (c.expires_at IS NULL OR c.expires_at > unixepoch())
            LIMIT 1`,
      args: [hashed],
    })
    agent = namedResult?.rows?.[0]
    namedCredential = agent || null
  }
  if (!agent?.id) return { kind: 'invalid' }
  if (agent.api_key_revoked_at != null || agent.archived_at != null) return { kind: 'invalid' }

  const status = agent.status === 'active' ? 'active' : 'inactive'
  if (!options.allowInactive && status !== 'active') return { kind: 'invalid' }

  const credential = namedCredential
    ? 'named'
    : [hashed, legacyHashed, apiKey].includes(String(agent.api_key))
      ? 'current'
      : 'previous'
  const scopes = namedCredential
    ? parseAgentCredentialScopes(namedCredential.scopes)
    : [...AGENT_CREDENTIAL_SCOPES]
  const agentId = String(agent.id)
  if (options.requiredScope && !hasAgentCredentialScope(scopes, options.requiredScope)) {
    return { kind: 'forbidden', agentId, requiredScope: options.requiredScope }
  }

  // Transparently upgrade API keys created by older releases from plaintext or
  // unkeyed SHA-256 digests.
  if (credential === 'current' && agent.api_key !== hashed) {
    await client.execute({
      sql: `UPDATE agents SET api_key = ?, api_key_prefix = COALESCE(api_key_prefix, ?)
            WHERE id = ? AND api_key = ?`,
      args: [hashed, agentApiKeyPrefix(apiKey), String(agent.id), String(agent.api_key)],
    })
  }

  if (credential === 'named') {
    await client.execute({
      sql: `UPDATE agent_credentials SET last_used_at = unixepoch()
            WHERE id = ? AND (last_used_at IS NULL OR last_used_at < unixepoch() - ?)`,
      args: [String(namedCredential?.credential_id), AGENT_ACTIVITY_WRITE_INTERVAL_SECONDS],
    }).catch(() => undefined)
  } else {
    await client.execute({
      sql: `UPDATE agents SET api_key_last_used_at = unixepoch()
            WHERE id = ? AND (api_key_last_used_at IS NULL OR api_key_last_used_at < unixepoch() - ?)`,
      args: [agentId, AGENT_ACTIVITY_WRITE_INTERVAL_SECONDS],
    }).catch(() => undefined)
  }
  if (status === 'active') {
    // Authenticated API activity is a presence signal. Coalescing updates keeps
    // ordinary polling from turning into a write on every request.
    await client.execute({
      sql: `UPDATE agents
            SET last_seen_at = unixepoch(), is_online = 1
            WHERE id = ? AND status = 'active' AND (
              COALESCE(is_online, 0) != 1
              OR last_seen_at IS NULL
              OR last_seen_at < unixepoch() - ?
            )`,
      args: [agentId, AGENT_ACTIVITY_WRITE_INTERVAL_SECONDS],
    }).catch(() => undefined)
  }

  return {
    kind: 'agent',
    agentId,
    name: String(agent.name || agentId),
    syntheticUserId: `user_agent_${agentId}`,
    status,
    credential,
    credentialId: credential === 'named' ? String(namedCredential?.credential_id) : null,
    credentialName: credential === 'named' ? String(namedCredential?.credential_name || 'Named credential') : 'Primary',
    credentialPrefix: credential === 'named'
      ? String(namedCredential?.credential_prefix || '') || null
      : credential === 'previous'
        ? String(agent.previous_api_key_prefix || '') || null
        : String(agent.api_key_prefix || '') || null,
    credentialLastUsedAt: credential === 'named' ? Math.floor(Date.now() / 1000) : null,
    scopes,
  }
}

export async function resolveRegisteredAgentBearer(authHeader: string | null): Promise<RegisteredAgentAuth> {
  const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : ''
  return resolveRegisteredAgentApiKey(apiKey, !!authHeader?.startsWith('Bearer '))
}

export async function resolveRegisteredAgentRequest(
  request: NextRequest,
  options: { allowInactive?: boolean; requiredScope?: AgentCredentialScope | null } = {},
): Promise<RegisteredAgentAuth> {
  const apiKey = registeredAgentApiKeyFromRequest(request)
  const hasCredential = Boolean(
    request.headers.get('x-clawdmarket-agent-key') ||
    request.headers.get('x-agent-api-key') ||
    request.headers.get('authorization')?.startsWith('Bearer '),
  )
  return resolveRegisteredAgentApiKey(apiKey, hasCredential, {
    allowInactive: options.allowInactive,
    requiredScope: options.requiredScope === null
      ? undefined
      : options.requiredScope || requiredAgentCredentialScope(request),
  })
}

export async function ensureSyntheticAgentUser(agent: {
  agentId: string
  name: string
  syntheticUserId: string
}) {
  const client = (db as any).$client
  const nowIso = new Date().toISOString()

  await client.execute({
    sql: `INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at)
          VALUES (?, ?, ?, ?, 'agent', ?)`,
    args: [
      agent.syntheticUserId,
      `${agent.agentId}@agent.clawdmkt.com`,
      crypto.randomBytes(32).toString('hex'),
      agent.name,
      nowIso,
    ],
  })
  await client.execute({
    sql: `INSERT OR IGNORE INTO wallets (user_id, balance, escrow, created_at)
          VALUES (?, 0, 0, ?)`,
    args: [agent.syntheticUserId, nowIso],
  })
}
