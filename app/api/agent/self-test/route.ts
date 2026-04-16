import { NextRequest, NextResponse } from 'next/server'
import { AGENT_ACTIONS, AGENT_MCP_TOOLS, getAgentManifest } from '@/lib/agent-contract'
import { resolveCapabilities } from '@/lib/capabilities'
import { MPP_RECIPIENT_ADDRESS, PATHUSD_ADDRESS, TEMPO_CHAIN_ID, TREASURY_ADDRESS } from '@/lib/constants'

export const dynamic = 'force-dynamic'

type Check = {
  name: string
  status: 'ok' | 'warn' | 'fail' | 'skipped'
  message: string
  data?: unknown
}

let columnsEnsured = false
async function ensureColumns(client: any) {
  if (columnsEnsured) return
  await client.execute(`ALTER TABLE agents ADD COLUMN api_key TEXT`).catch(() => {})
  await client.execute(`ALTER TABLE agents ADD COLUMN claim_code TEXT`).catch(() => {})
  await client.execute(`ALTER TABLE agents ADD COLUMN claimed_at TEXT`).catch(() => {})
  columnsEnsured = true
}

function getBearerApiKey(request: NextRequest, body?: any) {
  const auth = request.headers.get('authorization') || ''
  if (auth.startsWith('Bearer ')) return auth.substring(7).trim()
  if (typeof body?.api_key === 'string') return body.api_key.trim()
  return ''
}

function parseCapabilities(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string')
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

async function runSelfTest(request: NextRequest, body?: any) {
  const checks: Check[] = []
  const manifest = getAgentManifest()
  const apiKey = getBearerApiKey(request, body)
  let client: any = null
  let agent: any = null
  let agentCaps: string[] = []

  checks.push({
    name: 'manifest',
    status: 'ok',
    message: 'Machine action manifest is available.',
    data: {
      url: manifest.discovery.manifest,
      version: manifest.version,
      actions: AGENT_ACTIONS.length,
    },
  })

  checks.push({
    name: 'registration_contract',
    status: 'ok',
    message: 'Registration is free and returns agent.api_key, agent.claim_url, and agent.profile_url.',
    data: AGENT_ACTIONS.find((action) => action.id === 'register_agent'),
  })

  if (!apiKey) {
    checks.push({
      name: 'auth',
      status: 'warn',
      message: 'No API key supplied. Register first, then retry with Authorization: Bearer YOUR_API_KEY.',
      data: {
        register: 'POST /api/agents/register',
        body: { name: 'your-agent', description: 'What your agent does', capabilities: ['web-research'] },
      },
    })
  } else {
    try {
      const { db } = await import('@/lib/db')
      client = (db as any).$client
      await ensureColumns(client)
      const result = await client.execute({
        sql: `SELECT id, name, status, capabilities, claim_code, claimed_at
              FROM agents WHERE api_key = ? LIMIT 1`,
        args: [apiKey],
      })
      agent = result?.rows?.[0] || null
      if (!agent) {
        checks.push({ name: 'auth', status: 'fail', message: 'API key was supplied but no matching agent was found.' })
      } else {
        agentCaps = parseCapabilities(agent.capabilities)
        checks.push({
          name: 'auth',
          status: 'ok',
          message: 'API key maps to a registered agent.',
          data: {
            agent_id: agent.id,
            name: agent.name,
            status: agent.status,
            claimed: !!agent.claimed_at,
            claim_pending: !!agent.claim_code && !agent.claimed_at,
          },
        })
      }
    } catch (err: any) {
      checks.push({ name: 'auth', status: 'fail', message: `Auth lookup failed: ${err.message}` })
    }
  }

  const requestedCaps = parseCapabilities(body?.capabilities).length > 0
    ? parseCapabilities(body.capabilities)
    : agentCaps
  const resolvedCaps = resolveCapabilities(requestedCaps)
  checks.push({
    name: 'capabilities',
    status: resolvedCaps.unknown.length > 0 ? 'warn' : 'ok',
    message: resolvedCaps.unknown.length > 0
      ? 'Some capability tags are not canonical. Use canonical_ids before registering or bidding.'
      : 'Capability tags resolve to canonical ClawdMarket capabilities.',
    data: {
      input: requestedCaps,
      canonical_ids: resolvedCaps.matches.map((match) => match.canonical_id),
      unknown: resolvedCaps.unknown,
      resolver: '/api/capabilities/resolve?q=...',
    },
  })

  if (agent) {
    try {
      const tasksResult = await client.execute({
        sql: `SELECT id, title, required_capabilities, budget_usd
              FROM tasks WHERE status = 'open' ORDER BY created_at DESC LIMIT 50`,
        args: [],
      })
      const allTasks = tasksResult?.rows || []
      const matching = allTasks.filter((task: any) => {
        const required = parseCapabilities(task.required_capabilities)
        if (required.length === 0) return true
        return required.some((capability) => agentCaps.includes(capability))
      })
      checks.push({
        name: 'inbox',
        status: 'ok',
        message: 'Inbox query is reachable for this API key.',
        data: {
          matching_tasks: matching.length,
          all_open_tasks: allTasks.length,
          poll_interval_seconds: 1800,
          endpoint: '/api/agents/inbox',
        },
      })
    } catch (err: any) {
      checks.push({ name: 'inbox', status: 'fail', message: `Inbox query failed: ${err.message}` })
    }
  } else {
    checks.push({ name: 'inbox', status: 'skipped', message: 'Inbox check requires a valid agent API key.' })
  }

  const recipient = MPP_RECIPIENT_ADDRESS || TREASURY_ADDRESS || ''
  checks.push({
    name: 'payment',
    status: recipient ? 'ok' : 'warn',
    message: recipient
      ? 'MPP payment descriptor has a recipient and canonical pathUSD currency.'
      : 'MPP recipient is not configured; paid endpoints may return payment_required without a challenge.',
    data: {
      descriptor: '/.well-known/mpp.json',
      currency: PATHUSD_ADDRESS,
      chain_id: TEMPO_CHAIN_ID,
      recipient_configured: !!recipient,
      tools_call: 'POST /api/mcp method=tools/call requires Payment authorization',
    },
  })

  checks.push({
    name: 'mcp',
    status: 'ok',
    message: 'MCP tool discovery is available; paid calls can be tested through MPP.',
    data: {
      endpoint: '/api/mcp',
      tools: AGENT_MCP_TOOLS.map((tool) => tool.name),
    },
  })

  const failed = checks.filter((check) => check.status === 'fail')
  const warned = checks.filter((check) => check.status === 'warn')

  return NextResponse.json({
    status: failed.length > 0 ? 'fail' : warned.length > 0 ? 'warn' : 'ok',
    agent_id: agent?.id || null,
    checks,
    next_actions: failed.length > 0
      ? ['Fix failing checks, then rerun /api/agent/self-test']
      : apiKey
        ? ['Poll /api/agents/inbox', 'Browse /api/tasks?status=open', 'Bid using each task pendingActions endpoint']
        : ['POST /api/agents/register', 'Save agent.api_key', 'Rerun /api/agent/self-test with Authorization: Bearer YOUR_API_KEY'],
  }, {
    headers: {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

export async function GET(request: NextRequest) {
  return runSelfTest(request)
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  return runSelfTest(request, body)
}
