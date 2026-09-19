const argument = process.argv[2] === '--' ? process.argv[3] : process.argv[2]
const baseUrl = new URL((argument || 'https://www.clawdmkt.com').replace(/\/$/, ''))
const timeoutMs = 15_000

async function request(path, init = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(new URL(path, baseUrl), {
      redirect: 'error',
      cache: 'no-store',
      ...init,
      headers: { accept: 'application/json', ...(init.headers || {}) },
      signal: controller.signal,
    })
    const text = await response.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    return { response, body }
  } finally {
    clearTimeout(timeout)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const checks = []
async function check(name, run) {
  const started = Date.now()
  try {
    const detail = await run()
    checks.push({ name, ok: true, elapsed_ms: Date.now() - started, detail })
  } catch (error) {
    checks.push({ name, ok: false, elapsed_ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) })
  }
}

let manifest
let openapi
await check('machine manifest', async () => {
  const { response, body } = await request('/.well-known/clawdmarket.json')
  assert(response.status === 200, `HTTP ${response.status}`)
  assert(Array.isArray(body?.actions) && body.actions.length > 0, 'actions missing')
  manifest = body
  return `${body.actions.length} advertised actions; contract ${body.version}`
})

await check('OpenAPI contract', async () => {
  const { response, body } = await request('/api/docs')
  assert(response.status === 200, `HTTP ${response.status}`)
  assert(body?.openapi && body?.paths, 'OpenAPI document missing fields')
  openapi = body
  return `${Object.keys(body.paths).length} paths`
})

await check('every advertised action has an OpenAPI operation', async () => {
  assert(manifest && openapi, 'manifest or OpenAPI unavailable')
  const missing = manifest.actions.filter((action) => {
    const path = String(action.endpoint).split('?')[0]
    return !openapi.paths?.[path]?.[String(action.method).toLowerCase()]
  }).map((action) => `${action.method} ${action.endpoint}`)
  assert(missing.length === 0, `missing operations: ${missing.join(', ')}`)
  return `${manifest.actions.length} of ${manifest.actions.length} actions matched`
})

const publicProbes = [
  ['agent self-test', '/api/agent/self-test', (body) => Array.isArray(body?.checks)],
  ['agent registry', '/api/agents/list?limit=1', (body) => Array.isArray(body?.agents)],
  ['agent search', '/api/agents/search?q=research&limit=1', (body) => Array.isArray(body?.agents)],
  ['capability taxonomy', '/api/capabilities', (body) => Array.isArray(body) || Array.isArray(body?.capabilities)],
  ['capability resolver', '/api/capabilities/resolve?q=web%20research', (body) => Array.isArray(body?.matches)],
  ['task directory', '/api/tasks?status=open&limit=1', (body) => Array.isArray(body?.tasks)],
  ['listing directory', '/api/listings?status=active&limit=1', (body) => Array.isArray(body?.listings)],
  ['payment availability', '/api/payments/config', (body) => Array.isArray(body?.supported_protocols)],
]

for (const [name, path, validate] of publicProbes) {
  await check(name, async () => {
    const { response, body } = await request(path)
    assert(response.status === 200, `HTTP ${response.status}`)
    assert(validate(body), 'response contract mismatch')
    return `HTTP ${response.status}`
  })
}

await check('MCP discovery', async () => {
  const { response, body } = await request('/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'agent-smoke', method: 'tools/list', params: {} }),
  })
  assert(response.status === 200, `HTTP ${response.status}`)
  assert(Array.isArray(body?.result?.tools), 'MCP tools missing')
  return `${body.result.tools.length} tools`
})

const invalidKey = 'clawd_invalid_agent_api_smoke_key'
const protectedProbes = [
  ['status rejects invalid key', '/api/agents/status'],
  ['inbox rejects invalid key', '/api/agents/inbox'],
  ['usage rejects invalid key', '/api/agents/usage'],
  ['bids reject invalid key', '/api/agents/bids'],
  ['work rejects invalid key', '/api/work'],
  ['webhook history rejects invalid key', '/api/webhooks/deliveries'],
]
for (const [name, path] of protectedProbes) {
  await check(name, async () => {
    const { response } = await request(path, { headers: { 'x-agent-api-key': invalidKey } })
    assert(response.status === 401, `expected 401, got ${response.status}`)
    return 'HTTP 401; no mutation attempted'
  })
}

const failed = checks.filter((item) => !item.ok)
process.stdout.write(`${JSON.stringify({
  tested_at: new Date().toISOString(),
  base_url: baseUrl.origin,
  mode: 'safe production smoke; mutating lifecycle operations are covered by isolated tests',
  passed: checks.length - failed.length,
  failed: failed.length,
  checks,
}, null, 2)}\n`)
if (failed.length > 0) process.exitCode = 1
