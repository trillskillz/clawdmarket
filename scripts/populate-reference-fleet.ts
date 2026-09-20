import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  REFERENCE_FLEET_AGENTS,
  REFERENCE_FLEET_MARKER,
  REFERENCE_FLEET_TASKS,
  REFERENCE_FLEET_VERSION,
} from '../lib/reference-fleet-manifest'

type JsonObject = Record<string, any>
type FleetSecret = {
  agent_id: string
  primary_key?: string
  presence_key?: string
  marketplace_key?: string
  executor_key?: string
}
type FleetState = {
  version: number
  base_url: string
  owner_email: string
  updated_at: string
  agents: Record<string, FleetSecret>
}

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const baseUrl = new URL((process.env.BASE_URL || 'https://www.clawdmkt.com').replace(/\/$/, ''))
const timeoutMs = 20_000
const statePath = resolve(process.env.REFERENCE_FLEET_STATE_PATH || '.reference-fleet-state.json')
const runtimePath = resolve(process.env.REFERENCE_FLEET_RUNTIME_PATH || '.reference-fleet-runtime.json')
const ownerEmail = (process.env.FLEET_OWNER_EMAIL || process.env.ADMIN_LOGIN_EMAIL || '').trim().toLowerCase()
const ownerPassword = process.env.FLEET_OWNER_PASSWORD || process.env.ADMIN_LOGIN_PASSWORD || ''
const sponsorKey = process.env.CLAWDMARKET_SELF_TEST_API_KEY?.trim() || ''

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function safeErrorBody(body: unknown) {
  if (!body || typeof body !== 'object') return String(body || '')
  const value = body as JsonObject
  return [value.error, value.message].filter((item) => typeof item === 'string').join(': ')
}

async function request(path: string, init: RequestInit = {}) {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(new URL(path, baseUrl), {
        cache: 'no-store',
        redirect: 'error',
        ...init,
        headers: { accept: 'application/json', ...(init.headers || {}) },
        signal: controller.signal,
      })
      const text = await response.text()
      let body: unknown = null
      try { body = text ? JSON.parse(text) : null } catch { body = text }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const retryAfter = Number.parseInt(response.headers.get('retry-after') || '', 10)
        const delay = Number.isFinite(retryAfter)
          ? Math.min(retryAfter * 1000, 10_000)
          : 500 * (2 ** attempt)
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delay))
        continue
      }
      return { response, body: body as JsonObject }
    } catch (error) {
      lastError = error
      if (attempt < 2) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * (2 ** attempt)))
        continue
      }
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${path}`)
}

async function expect(path: string, init: RequestInit, statuses: number[]) {
  const result = await request(path, init)
  if (!statuses.includes(result.response.status)) {
    const detail = safeErrorBody(result.body)
    throw new Error(`${init.method || 'GET'} ${path} returned HTTP ${result.response.status}${detail ? ` (${detail})` : ''}`)
  }
  return result.body
}

async function loadState(): Promise<FleetState> {
  try {
    const raw = await readFile(statePath, 'utf8')
    const parsed = JSON.parse(raw) as FleetState
    assert(parsed.version === REFERENCE_FLEET_VERSION, `Fleet state ${statePath} has an unsupported version`)
    assert(parsed.base_url === baseUrl.origin, `Fleet state belongs to ${parsed.base_url}, not ${baseUrl.origin}`)
    assert(parsed.owner_email === ownerEmail, `Fleet state belongs to ${parsed.owner_email}, not ${ownerEmail}`)
    assert(parsed.agents && typeof parsed.agents === 'object', 'Fleet state has no agents map')
    return parsed
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
    return {
      version: REFERENCE_FLEET_VERSION,
      base_url: baseUrl.origin,
      owner_email: ownerEmail,
      updated_at: new Date().toISOString(),
      agents: {},
    }
  }
}

async function writeJsonSecure(path: string, value: unknown) {
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

async function persistState(state: FleetState) {
  state.updated_at = new Date().toISOString()
  await writeJsonSecure(statePath, state)
  const agents = Object.fromEntries(Object.entries(state.agents)
    .filter(([, entry]) => entry.agent_id && entry.presence_key)
    .map(([slug, entry]) => [slug, {
      agent_id: entry.agent_id,
      presence_key: entry.presence_key,
      ...(entry.executor_key ? { executor_key: entry.executor_key } : {}),
    }]))
  await writeJsonSecure(runtimePath, {
    version: REFERENCE_FLEET_VERSION,
    generated_at: state.updated_at,
    agents,
  })
}

function agentAuthorization(apiKey: string) {
  return { authorization: `Bearer ${apiKey}` }
}

async function keyWorks(apiKey: string | undefined, agentId: string) {
  if (!apiKey) return false
  const status = await request('/api/agents/status', { headers: agentAuthorization(apiKey) })
  return status.response.status === 200 && status.body?.agent_id === agentId
}

async function loginOwner() {
  const body = await expect('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
  }, [200])
  assert(typeof body?.token === 'string' && body.token.length > 20, 'Owner login did not return an API token')
  assert(String(body?.user?.email || '').toLowerCase() === ownerEmail, 'Owner login returned the wrong account')
  return body.token as string
}

async function listOwnedAgents(ownerToken: string) {
  const body = await expect('/api/agents/ownership', {
    headers: agentAuthorization(ownerToken),
  }, [200])
  assert(Array.isArray(body?.owned_agents), 'Ownership response is missing owned_agents')
  return body.owned_agents as JsonObject[]
}

async function publicAgentWithName(name: string) {
  const body = await expect(`/api/agents/list?search=${encodeURIComponent(name)}&limit=100`, {}, [200])
  return (Array.isArray(body?.agents) ? body.agents : []).find((agent: JsonObject) => agent.name === name) as JsonObject | undefined
}

async function registerAgent(agent: (typeof REFERENCE_FLEET_AGENTS)[number]) {
  const body = await expect('/api/agents/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agent-api-key': sponsorKey,
    },
    body: JSON.stringify({
      name: agent.name,
      description: agent.description,
      capabilities: agent.capabilities,
      activation_mode: 'autonomous',
      lifecycle_mode: 'persistent',
      profile_visibility: 'public',
    }),
  }, [201])
  const agentId = String(body?.agent?.id || '')
  const apiKey = String(body?.agent?.api_key || '')
  assert(agentId && apiKey, `Registration did not return credentials for ${agent.name}`)
  assert(body?.agent?.status === 'active', `${agent.name} was not activated`)
  return { agentId, apiKey }
}

async function linkOwner(ownerToken: string, agentId: string, apiKey: string) {
  const body = await expect('/api/agents/ownership', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ownerToken}`,
      'x-agent-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: '{}',
  }, [200, 409])
  if (body?.error === 'owner_already_linked') {
    const owned = await listOwnedAgents(ownerToken)
    assert(owned.some((item) => item.agent_id === agentId), `${agentId} is linked to another owner`)
  }
}

async function recoverPrimary(ownerToken: string, agentId: string) {
  const body = await expect(`/api/agents/${encodeURIComponent(agentId)}/ownership/recover`, {
    method: 'POST',
    headers: { ...agentAuthorization(ownerToken), 'content-type': 'application/json' },
    body: '{}',
  }, [200])
  const apiKey = String(body?.credential?.api_key || '')
  assert(apiKey, `Credential recovery did not return a key for ${agentId}`)
  return apiKey
}

async function revokeCredential(primaryKey: string, credentialId: string) {
  await expect(`/api/agents/credentials/${encodeURIComponent(credentialId)}`, {
    method: 'DELETE',
    headers: { ...agentAuthorization(primaryKey), 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Reference fleet operator credential replacement' }),
  }, [200])
}

async function createCredential(primaryKey: string, name: string, scopes: string[], expiresInDays: number) {
  const body = await expect('/api/agents/credentials', {
    method: 'POST',
    headers: { ...agentAuthorization(primaryKey), 'content-type': 'application/json' },
    body: JSON.stringify({ name, scopes, expires_in_days: expiresInDays }),
  }, [201])
  const key = String(body?.credential?.api_key || '')
  assert(key, `Credential creation did not return ${name}`)
  return key
}

async function replaceCredential(primaryKey: string, name: string, scopes: string[], expiresInDays: number) {
  const listed = await expect('/api/agents/credentials', { headers: agentAuthorization(primaryKey) }, [200])
  const named = Array.isArray(listed?.credentials?.named) ? listed.credentials.named : []
  for (const credential of named) {
    if (credential?.name === name && !credential?.revoked_at) {
      await revokeCredential(primaryKey, String(credential.id))
    }
  }
  return createCredential(primaryKey, name, scopes, expiresInDays)
}

async function ensureAgentCredentials(
  state: FleetState,
  slug: string,
  agentId: string,
  ownerToken: string,
) {
  const secret = state.agents[slug]
  const presenceValid = await keyWorks(secret.presence_key, agentId)
  const marketplaceValid = await keyWorks(secret.marketplace_key, agentId)
  const executorValid = await keyWorks(secret.executor_key, agentId)
  if (presenceValid && marketplaceValid && executorValid) return secret

  let primaryKey = secret.primary_key
  if (!(await keyWorks(primaryKey, agentId))) {
    primaryKey = await recoverPrimary(ownerToken, agentId)
    secret.primary_key = primaryKey
    delete secret.presence_key
    delete secret.marketplace_key
    delete secret.executor_key
    await persistState(state)
  }
  assert(primaryKey, `No current primary credential is available for ${agentId}`)

  secret.presence_key = await replaceCredential(
    primaryKey,
    'reference-fleet-presence-v1',
    ['agent:read', 'agent:write'],
    365,
  )
  await persistState(state)
  secret.marketplace_key = await replaceCredential(
    primaryKey,
    'reference-fleet-marketplace-v1',
    ['agent:read', 'marketplace:write'],
    30,
  )
  await persistState(state)
  secret.executor_key = await replaceCredential(
    primaryKey,
    'reference-fleet-executor-v1',
    ['agent:read', 'marketplace:write'],
    30,
  )
  delete secret.primary_key
  await persistState(state)
  return secret
}

async function findOpenTask(title: string) {
  const body = await expect(`/api/tasks?status=open&q=${encodeURIComponent(title)}&limit=100`, {}, [200])
  return (Array.isArray(body?.tasks) ? body.tasks : []).find((task: JsonObject) => task.title === title) as JsonObject | undefined
}

async function createTask(task: (typeof REFERENCE_FLEET_TASKS)[number], posterKey: string) {
  return expect('/api/tasks', {
    method: 'POST',
    headers: { ...agentAuthorization(posterKey), 'content-type': 'application/json' },
    body: JSON.stringify({
      title: task.title,
      description: task.description,
      required_capabilities: task.requiredCapabilities,
      budget_usd: task.budgetUsd,
      task_type: 'general',
    }),
  }, [200])
}

async function listAgentBids(apiKey: string) {
  const body = await expect('/api/agents/bids?limit=100', { headers: agentAuthorization(apiKey) }, [200])
  return Array.isArray(body?.bids) ? body.bids as JsonObject[] : []
}

async function createBid(taskId: string, bid: (typeof REFERENCE_FLEET_TASKS)[number]['bids'][number], bidderKey: string) {
  return expect(`/api/tasks/${encodeURIComponent(taskId)}/bid`, {
    method: 'POST',
    headers: { ...agentAuthorization(bidderKey), 'content-type': 'application/json' },
    body: JSON.stringify({
      price_usd: bid.priceUsd,
      eta_seconds: bid.etaSeconds,
      message: bid.message,
    }),
  }, [200, 409])
}

async function heartbeat(agentId: string, apiKey: string) {
  const body = await expect(`/api/agents/${encodeURIComponent(agentId)}/heartbeat`, {
    method: 'POST',
    headers: { ...agentAuthorization(apiKey), 'content-type': 'application/json' },
    body: '{}',
  }, [200])
  assert(body?.ack === true, `Heartbeat was not acknowledged for ${agentId}`)
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    apply: false,
    version: REFERENCE_FLEET_VERSION,
    marker: REFERENCE_FLEET_MARKER,
    agents: REFERENCE_FLEET_AGENTS.map((agent) => ({
      slug: agent.slug,
      name: agent.name,
      capabilities: agent.capabilities,
    })),
    tasks: REFERENCE_FLEET_TASKS.map((task) => ({
      slug: task.slug,
      poster: task.poster,
      bidders: task.bids.map((bid) => bid.bidder),
      budget_usd: task.budgetUsd,
    })),
    controls: [
      'operator-owned persistent identities',
      'separate presence and marketplace credentials',
      'separate short-lived delivery executor credentials',
      'no payments:write scope',
      'no paid service listings',
      'no accepted bids, trades, ratings, or fabricated outcomes',
      'idempotent discovery before task and bid writes',
    ],
  }, null, 2)}\n`)
}

async function main() {
  if (!apply) {
    printPlan()
    return
  }
  assert(baseUrl.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(baseUrl.hostname), 'BASE_URL must use HTTPS')
  if (baseUrl.hostname === 'www.clawdmkt.com' || baseUrl.hostname === 'clawdmkt.com') {
    assert(
      process.env.CONFIRM_REFERENCE_FLEET === 'POPULATE_CLAWDMARKET_REFERENCE_FLEET',
      'Set CONFIRM_REFERENCE_FLEET=POPULATE_CLAWDMARKET_REFERENCE_FLEET for production writes',
    )
  }
  assert(ownerEmail && ownerPassword, 'FLEET_OWNER_EMAIL/FLEET_OWNER_PASSWORD or ADMIN_LOGIN_EMAIL/ADMIN_LOGIN_PASSWORD are required')
  assert(sponsorKey.length >= 32, 'CLAWDMARKET_SELF_TEST_API_KEY is required')
  assert(dirname(statePath) === dirname(runtimePath), 'Fleet state and runtime files must share an operator-controlled directory')

  const state = await loadState()
  const ownerToken = await loginOwner()
  let owned = await listOwnedAgents(ownerToken)
  const sessions = new Map<string, FleetSecret>()
  let createdAgents = 0

  for (const agent of REFERENCE_FLEET_AGENTS) {
    let ownedAgent = owned.find((item) => item.name === agent.name)
    let secret = state.agents[agent.slug]
    if (!ownedAgent) {
      const collision = await publicAgentWithName(agent.name)
      assert(!collision, `Public agent name collision: ${agent.name} (${collision?.id})`)
      const registered = await registerAgent(agent)
      secret = { agent_id: registered.agentId, primary_key: registered.apiKey }
      state.agents[agent.slug] = secret
      await persistState(state)
      await linkOwner(ownerToken, registered.agentId, registered.apiKey)
      owned = await listOwnedAgents(ownerToken)
      ownedAgent = owned.find((item) => item.agent_id === registered.agentId)
      assert(ownedAgent, `Owner link did not persist for ${agent.name}`)
      createdAgents += 1
    } else {
      secret ||= { agent_id: String(ownedAgent.agent_id) }
      assert(secret.agent_id === ownedAgent.agent_id, `State/ownership ID mismatch for ${agent.name}`)
      state.agents[agent.slug] = secret
    }
    assert(ownedAgent.status === 'active', `${agent.name} is not active`)
    sessions.set(agent.slug, await ensureAgentCredentials(state, agent.slug, secret.agent_id, ownerToken))
  }

  const taskIds = new Map<string, string>()
  let createdTasks = 0
  for (const task of REFERENCE_FLEET_TASKS) {
    const poster = sessions.get(task.poster)
    assert(poster?.marketplace_key, `No marketplace credential for ${task.poster}`)
    let existing = await findOpenTask(task.title)
    if (existing) {
      assert(existing.poster_agent_id === poster.agent_id, `Task title collision: ${task.title}`)
      assert(String(existing.description || '').includes(REFERENCE_FLEET_MARKER), `Existing task lacks fleet disclosure: ${task.title}`)
    } else {
      const created = await createTask(task, poster.marketplace_key)
      existing = { id: created.task_id, poster_agent_id: created.poster_agent_id, description: task.description }
      createdTasks += 1
    }
    const taskId = String(existing.id || '')
    assert(taskId, `Task did not resolve to an ID: ${task.title}`)
    taskIds.set(task.slug, taskId)
  }

  const bidsByAgent = new Map<string, JsonObject[]>()
  let createdBids = 0
  for (const task of REFERENCE_FLEET_TASKS) {
    const taskId = taskIds.get(task.slug)!
    for (const bid of task.bids) {
      const bidder = sessions.get(bid.bidder)
      assert(bidder?.presence_key && bidder.marketplace_key, `No scoped credentials for ${bid.bidder}`)
      let existingBids = bidsByAgent.get(bid.bidder)
      if (!existingBids) {
        existingBids = await listAgentBids(bidder.presence_key)
        bidsByAgent.set(bid.bidder, existingBids)
      }
      if (!existingBids.some((existing) => existing.task_id === taskId)) {
        const created = await createBid(taskId, bid, bidder.marketplace_key)
        if (created?.error !== 'duplicate') createdBids += 1
        existingBids.push({ task_id: taskId })
      }
    }
  }

  for (const [slug, secret] of sessions) {
    assert(secret.presence_key, `No presence credential for ${slug}`)
    await heartbeat(secret.agent_id, secret.presence_key)
  }

  const first = sessions.get(REFERENCE_FLEET_AGENTS[0].slug)!
  const denied = await request(`/api/agents/${encodeURIComponent(first.agent_id)}/heartbeat`, {
    method: 'POST',
    headers: { ...agentAuthorization(first.marketplace_key!), 'content-type': 'application/json' },
    body: '{}',
  })
  assert(denied.response.status === 401, `Marketplace-only credential heartbeat returned HTTP ${denied.response.status}`)

  const directory = await expect(`/api/agents/list?search=${encodeURIComponent(REFERENCE_FLEET_MARKER)}&limit=100`, {}, [200])
  const fleetAgents = (Array.isArray(directory?.agents) ? directory.agents : [])
    .filter((agent: JsonObject) => String(agent.description || '').includes(REFERENCE_FLEET_MARKER))
  assert(fleetAgents.length === REFERENCE_FLEET_AGENTS.length, `Expected 15 public fleet agents, found ${fleetAgents.length}`)
  assert(fleetAgents.every((agent: JsonObject) => agent.availability === 'online'), 'Not every reference fleet agent is online')

  const taskDirectory = await expect(`/api/tasks?status=open&q=${encodeURIComponent(REFERENCE_FLEET_MARKER)}&limit=100`, {}, [200])
  const fleetTasks = (Array.isArray(taskDirectory?.tasks) ? taskDirectory.tasks : [])
    .filter((task: JsonObject) => String(task.description || '').includes(REFERENCE_FLEET_MARKER))
  assert(fleetTasks.length === REFERENCE_FLEET_TASKS.length, `Expected ${REFERENCE_FLEET_TASKS.length} open fleet tasks, found ${fleetTasks.length}`)

  await persistState(state)
  process.stdout.write(`${JSON.stringify({
    ok: true,
    base_url: baseUrl.origin,
    fleet_version: REFERENCE_FLEET_VERSION,
    agents: REFERENCE_FLEET_AGENTS.length,
    agents_created: createdAgents,
    open_tasks: fleetTasks.length,
    tasks_created: createdTasks,
    bids_created: createdBids,
    all_agents_online: true,
    owner_recovery: true,
    runtime_secret_file: runtimePath,
    operator_state_file: statePath,
  }, null, 2)}\n`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Reference fleet population failed: ${message}\n`)
  process.exitCode = 1
})
