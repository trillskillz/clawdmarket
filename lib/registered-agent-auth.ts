import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { AGENT_ACTIVITY_WRITE_INTERVAL_SECONDS } from '@/lib/agent-presence'

type AgentAuthNone = { kind: 'none' }
type AgentAuthInvalid = { kind: 'invalid' }
type AgentAuthValid = {
  kind: 'agent'
  agentId: string
  name: string
  syntheticUserId: string
  status: 'active' | 'inactive'
}

export type RegisteredAgentAuth = AgentAuthNone | AgentAuthInvalid | AgentAuthValid

export function hashAgentApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex')
}

export function agentApiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, 12)
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
  options: { allowInactive?: boolean } = {},
): Promise<RegisteredAgentAuth> {
  return resolveRegisteredAgentApiKey(apiKey, Boolean(apiKey), options)
}

async function resolveRegisteredAgentApiKey(
  apiKey: string,
  hasCredential: boolean,
  options: { allowInactive?: boolean } = {},
): Promise<RegisteredAgentAuth> {
  if (!hasCredential) return { kind: 'none' }
  if (!apiKey) return { kind: 'invalid' }

  const client = (db as any).$client
  const hashed = hashAgentApiKey(apiKey)
  const result = await client.execute({
    sql: `SELECT id, name, status, api_key, api_key_prefix, api_key_revoked_at, archived_at
          FROM agents WHERE api_key IN (?, ?) LIMIT 1`,
    args: [hashed, apiKey],
  })
  const agent = result?.rows?.[0]
  if (!agent?.id) return { kind: 'invalid' }
  if (agent.api_key_revoked_at != null || agent.archived_at != null) return { kind: 'invalid' }

  const status = agent.status === 'active' ? 'active' : 'inactive'
  if (!options.allowInactive && status !== 'active') return { kind: 'invalid' }

  // Transparently upgrade API keys created by older releases from plaintext.
  if (agent.api_key === apiKey) {
    await client.execute({
      sql: `UPDATE agents SET api_key = ?, api_key_prefix = COALESCE(api_key_prefix, ?)
            WHERE id = ? AND api_key = ?`,
      args: [hashed, agentApiKeyPrefix(apiKey), String(agent.id), apiKey],
    })
  }

  const agentId = String(agent.id)
  await client.execute({
    sql: `UPDATE agents SET api_key_last_used_at = unixepoch()
          WHERE id = ? AND (api_key_last_used_at IS NULL OR api_key_last_used_at < unixepoch() - ?)`,
    args: [agentId, AGENT_ACTIVITY_WRITE_INTERVAL_SECONDS],
  }).catch(() => undefined)
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
  }
}

export async function resolveRegisteredAgentBearer(authHeader: string | null): Promise<RegisteredAgentAuth> {
  const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : ''
  return resolveRegisteredAgentApiKey(apiKey, !!authHeader?.startsWith('Bearer '))
}

export async function resolveRegisteredAgentRequest(
  request: NextRequest,
  options: { allowInactive?: boolean } = {},
): Promise<RegisteredAgentAuth> {
  const apiKey = registeredAgentApiKeyFromRequest(request)
  const hasCredential = Boolean(
    request.headers.get('x-clawdmarket-agent-key') ||
    request.headers.get('x-agent-api-key') ||
    request.headers.get('authorization')?.startsWith('Bearer '),
  )
  return resolveRegisteredAgentApiKey(apiKey, hasCredential, options)
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
