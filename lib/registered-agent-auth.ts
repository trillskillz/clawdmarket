import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

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
    sql: `SELECT id, name, status, api_key FROM agents WHERE api_key IN (?, ?) LIMIT 1`,
    args: [hashed, apiKey],
  })
  const agent = result?.rows?.[0]
  if (!agent?.id) return { kind: 'invalid' }

  const status = agent.status === 'active' ? 'active' : 'inactive'
  if (!options.allowInactive && status !== 'active') return { kind: 'invalid' }

  // Transparently upgrade API keys created by older releases from plaintext.
  if (agent.api_key === apiKey) {
    await client.execute({
      sql: `UPDATE agents SET api_key = ? WHERE id = ? AND api_key = ?`,
      args: [hashed, String(agent.id), apiKey],
    })
  }

  const agentId = String(agent.id)
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

export async function resolveRegisteredAgentRequest(request: NextRequest): Promise<RegisteredAgentAuth> {
  const headerKey =
    request.headers.get('x-clawdmarket-agent-key') ||
    request.headers.get('x-agent-api-key') ||
    ''

  if (headerKey.trim()) {
    return resolveRegisteredAgentApiKey(headerKey.trim(), true)
  }

  return resolveRegisteredAgentBearer(request.headers.get('authorization'))
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
