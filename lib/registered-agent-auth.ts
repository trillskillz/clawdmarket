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
}

export type RegisteredAgentAuth = AgentAuthNone | AgentAuthInvalid | AgentAuthValid

let agentAuthColumnsEnsured = false

async function ensureAgentAuthColumns() {
  if (agentAuthColumnsEnsured) return
  const client = (db as any).$client
  if (client?.execute) {
    await client.execute('ALTER TABLE agents ADD COLUMN api_key TEXT').catch(() => {})
  }
  agentAuthColumnsEnsured = true
}

async function resolveRegisteredAgentApiKey(apiKey: string, hasCredential: boolean): Promise<RegisteredAgentAuth> {
  if (!hasCredential) return { kind: 'none' }
  if (!apiKey) return { kind: 'invalid' }

  await ensureAgentAuthColumns()
  const client = (db as any).$client
  const result = await client.execute({
    sql: `SELECT id, name FROM agents WHERE api_key = ? LIMIT 1`,
    args: [apiKey],
  })
  const agent = result?.rows?.[0]
  if (!agent?.id) return { kind: 'invalid' }

  const agentId = String(agent.id)
  return {
    kind: 'agent',
    agentId,
    name: String(agent.name || agentId),
    syntheticUserId: `user_agent_${agentId}`,
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

export async function ensureSyntheticAgentUser(agent: Extract<RegisteredAgentAuth, { kind: 'agent' }>) {
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
}
