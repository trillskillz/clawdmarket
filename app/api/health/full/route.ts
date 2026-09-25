import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

export const dynamic = 'force-dynamic'

type RuntimeEnvironment = Record<string, string | undefined>

type Check = {
  name: string
  method: 'GET' | 'POST'
  path: string
  expectStatus: number
  expectJsonStatus?: string
  headers?: Record<string, string>
  body?: string
}

type CheckResult = {
  name: string
  status: number
  expected: number
  passed: boolean
  latency?: number
  path: string
  error?: 'request_failed'
  json_status?: string | null
  expected_json_status?: string
}

const CHECK_TIMEOUT_MS = 5_000

const checks: Check[] = [
  { name: 'health', method: 'GET', path: '/api/health', expectStatus: 200 },
  { name: 'readiness', method: 'GET', path: '/api/health/ready', expectStatus: 200, expectJsonStatus: 'ready' },
  { name: 'stats', method: 'GET', path: '/api/stats', expectStatus: 200 },
  { name: 'capabilities', method: 'GET', path: '/api/capabilities', expectStatus: 200 },
  { name: 'leaderboard', method: 'GET', path: '/api/leaderboard', expectStatus: 200 },
  { name: 'activity', method: 'GET', path: '/api/activity', expectStatus: 200 },
  { name: 'mpp_json', method: 'GET', path: '/api/.well-known/mpp.json', expectStatus: 200 },
  { name: 'agent_json', method: 'GET', path: '/.well-known/agent.json', expectStatus: 200 },
  { name: 'a2a_agent_card', method: 'GET', path: '/.well-known/agent-card.json', expectStatus: 200 },
  { name: 'agent_manifest', method: 'GET', path: '/.well-known/clawdmarket.json', expectStatus: 200 },
  { name: 'payments_config', method: 'GET', path: '/api/payments/config', expectStatus: 200 },
  { name: 'llms_txt', method: 'GET', path: '/llms.txt', expectStatus: 200 },
  { name: 'skill_md', method: 'GET', path: '/skill.md', expectStatus: 200 },
  { name: 'agent_self_test', method: 'GET', path: '/api/agent/self-test', expectStatus: 200 },
  { name: 'agents_list_free', method: 'GET', path: '/api/agents/list', expectStatus: 200 },
  { name: 'capabilities_resolve_free', method: 'GET', path: '/api/capabilities/resolve?q=web%20search', expectStatus: 200 },
  { name: 'messages_auth_required', method: 'GET', path: '/api/messages', expectStatus: 401 },
  { name: 'mcp_tools_list_free', method: 'POST', path: '/api/mcp', body: '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}', expectStatus: 200 },
  { name: 'root_indexable', method: 'GET', path: '/', expectStatus: 200, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } },
  { name: 'observe_public', method: 'GET', path: '/observe', expectStatus: 200, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } },
  { name: 'docs_public', method: 'GET', path: '/docs', expectStatus: 200, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } },
]

/**
 * Health probes must never follow the request Host header. Vercel supplies a
 * deployment-scoped hostname; local development uses a fixed loopback target.
 */
function resolveHealthCheckBaseUrl(env: RuntimeEnvironment = process.env): string {
  const explicit = env.CLAWDMARKET_HEALTH_BASE_URL?.trim()
  if (explicit) {
    const url = new URL(explicit)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('CLAWDMARKET_HEALTH_BASE_URL must be an HTTP(S) origin without credentials')
    }
    return url.origin
  }

  const vercelHost = env.VERCEL_URL?.trim().toLowerCase()
  if (vercelHost && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(vercelHost)) {
    return `https://${vercelHost}`
  }

  const configuredPublicUrl = env.NEXT_PUBLIC_BASE_URL?.trim()
  if (configuredPublicUrl) {
    const url = new URL(configuredPublicUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('NEXT_PUBLIC_BASE_URL must be an HTTP(S) origin without credentials')
    }
    return url.origin
  }

  if (env.VERCEL_ENV === 'production' || env.CLAWDMARKET_PRODUCTION_READINESS === 'true') {
    return 'https://www.clawdmkt.com'
  }

  const port = /^\d{2,5}$/.test(env.PORT || '') ? env.PORT : '3000'
  return `http://127.0.0.1:${port}`
}

async function runFullHealthChecks(
  fetcher: typeof fetch = fetch,
  env: RuntimeEnvironment = process.env,
) {
  const selfTestApiKey = (env.CLAWDMARKET_SELF_TEST_API_KEY || '').trim()
  const activeChecks = [...checks]
  if (selfTestApiKey) {
    activeChecks.push({
      name: 'agent_self_test_authenticated',
      method: 'GET',
      path: '/api/agent/self-test',
      expectStatus: 200,
      expectJsonStatus: 'ok',
      headers: { Authorization: `Bearer ${selfTestApiKey}` },
    })
  }

  const baseUrl = resolveHealthCheckBaseUrl(env)
  const results = await Promise.all(activeChecks.map(async (check): Promise<CheckResult> => {
    const start = Date.now()
    try {
      const response = await fetcher(`${baseUrl}${check.path}`, {
        method: check.method,
        headers: { 'Content-Type': 'application/json', ...(check.headers || {}) },
        body: check.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      })
      const latency = Date.now() - start
      let jsonStatus: string | null = null
      if (check.expectJsonStatus) {
        try {
          const data = await response.clone().json()
          jsonStatus = typeof data?.status === 'string' ? data.status : null
        } catch {
          jsonStatus = null
        }
      }
      const passed = response.status === check.expectStatus
        && (!check.expectJsonStatus || jsonStatus === check.expectJsonStatus)
      return {
        name: check.name,
        status: response.status,
        expected: check.expectStatus,
        ...(check.expectJsonStatus ? { json_status: jsonStatus, expected_json_status: check.expectJsonStatus } : {}),
        passed,
        latency,
        path: check.path,
      }
    } catch {
      return {
        name: check.name,
        status: 0,
        expected: check.expectStatus,
        passed: false,
        error: 'request_failed',
        path: check.path,
      }
    }
  }))

  const passed = results.filter((result) => result.passed).length
  const allPassed = passed === results.length
  return {
    httpStatus: allPassed ? 200 : 503,
    body: {
      status: allPassed ? 'ok' as const : 'degraded' as const,
      passed,
      total: results.length,
      timestamp: new Date().toISOString(),
      checks: results,
    },
  }
}

function isAuthorized(request: Request, secret: string): boolean {
  const authorization = request.headers.get('authorization') || ''
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  const actual = Buffer.from(supplied)
  const expected = Buffer.from(secret)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function GET(request: Request) {
  try {
    const selfTestApiKey = process.env.CLAWDMARKET_SELF_TEST_API_KEY?.trim() || ''
    const production = process.env.VERCEL_ENV === 'production'
      || process.env.CLAWDMARKET_PRODUCTION_READINESS === 'true'
    if (production && !selfTestApiKey) {
      return NextResponse.json({ status: 'degraded', error: 'health_check_auth_not_configured' }, {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' },
      })
    }
    if (production && !isAuthorized(request, selfTestApiKey)) {
      return NextResponse.json({ error: 'unauthorized' }, {
        status: 401,
        headers: { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer' },
      })
    }

    const result = await runFullHealthChecks()
    return NextResponse.json(result.body, {
      status: result.httpStatus,
      headers: {
        'Cache-Control': 'no-store',
        ...(result.httpStatus === 503 ? { 'Retry-After': '30' } : {}),
      },
    })
  } catch {
    return NextResponse.json({
      status: 'degraded',
      error: 'health_check_configuration_invalid',
      timestamp: new Date().toISOString(),
    }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' },
    })
  }
}
