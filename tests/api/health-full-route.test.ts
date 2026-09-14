import assert from 'node:assert/strict'
import test from 'node:test'
import { GET } from '@/app/api/health/full/route'

const managedEnvironmentKeys = [
  'CLAWDMARKET_HEALTH_BASE_URL',
  'CLAWDMARKET_PRODUCTION_READINESS',
  'CLAWDMARKET_SELF_TEST_API_KEY',
  'NEXT_PUBLIC_BASE_URL',
  'PORT',
  'VERCEL_ENV',
  'VERCEL_URL',
] as const

async function withRuntime<T>(
  env: Record<string, string>,
  fetcher: typeof fetch,
  callback: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch
  const originalEnvironment = Object.fromEntries(
    managedEnvironmentKeys.map((key) => [key, process.env[key]]),
  )
  for (const key of managedEnvironmentKeys) delete process.env[key]
  Object.assign(process.env, env)
  globalThis.fetch = fetcher
  try {
    return await callback()
  } finally {
    globalThis.fetch = originalFetch
    for (const key of managedEnvironmentKeys) {
      const value = originalEnvironment[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function expectedFetch(
  seen: URL[],
  options: { failPath?: string; onAuthenticated?: () => void } = {},
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    seen.push(url)
    const headers = new Headers(init?.headers)
    if (url.pathname === '/api/agent/self-test' && headers.has('authorization')) {
      options.onAuthenticated?.()
    }

    let status = 200
    if (url.pathname === options.failPath) status = 500
    else if (url.pathname === '/api/agents/register' && init?.method === 'POST') status = 400
    else if (url.pathname === '/api/trades' && init?.method === 'POST') status = 401
    else if (url.pathname === '/api/messages') status = 401

    const jsonStatus = url.pathname === '/api/health/ready' ? 'ready' : 'ok'
    return Response.json({ status: jsonStatus }, { status })
  }) as typeof fetch
}

test('full health uses the trusted Vercel deployment host and returns 200 when every check passes', async () => {
  const seen: URL[] = []
  await withRuntime(
    { VERCEL_URL: 'clawdmarket-abc123.vercel.app' },
    expectedFetch(seen),
    async () => {
      const response = await GET()
      const body = await response.json()
      assert.equal(response.status, 200)
      assert.equal(body.status, 'ok')
      assert.equal(body.passed, body.total)
      assert.ok(seen.length > 20)
      assert.ok(seen.every((url) => url.origin === 'https://clawdmarket-abc123.vercel.app'))
    },
  )
})

test('full health returns 503 when any check fails', async () => {
  const seen: URL[] = []
  await withRuntime(
    { NEXT_PUBLIC_BASE_URL: 'https://health.example/some/path' },
    expectedFetch(seen, { failPath: '/api/stats' }),
    async () => {
      const response = await GET()
      const body = await response.json()
      assert.equal(response.status, 503)
      assert.equal(body.status, 'degraded')
      assert.equal(body.checks.find((check: { name: string }) => check.name === 'stats').passed, false)
      assert.ok(seen.every((url) => url.origin === 'https://health.example'))
    },
  )
})

test('full health exercises authenticated agent access when a key is configured', async () => {
  let authenticated = false
  await withRuntime(
    {
      NEXT_PUBLIC_BASE_URL: 'https://health.example',
      CLAWDMARKET_SELF_TEST_API_KEY: 'test-agent-key',
    },
    expectedFetch([], { onAuthenticated: () => { authenticated = true } }),
    async () => {
      const response = await GET()
      const body = await response.json()
      assert.equal(response.status, 200)
      assert.equal(authenticated, true)
      assert.ok(body.checks.some((check: { name: string }) => check.name === 'agent_self_test_authenticated'))
    },
  )
})
