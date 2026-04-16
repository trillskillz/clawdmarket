import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type Check = {
  name: string
  method: 'GET' | 'POST'
  path: string
  expectStatus: number
  headers?: Record<string, string>
  body?: string
}

export async function GET(req: Request) {
  const checks: Check[] = [
    { name: 'health', method: 'GET', path: '/api/health', expectStatus: 200 },
    { name: 'stats', method: 'GET', path: '/api/stats', expectStatus: 200 },
    { name: 'capabilities', method: 'GET', path: '/api/capabilities', expectStatus: 200 },
    { name: 'leaderboard', method: 'GET', path: '/api/leaderboard', expectStatus: 200 },
    { name: 'activity', method: 'GET', path: '/api/activity', expectStatus: 200 },
    { name: 'mpp_json', method: 'GET', path: '/api/.well-known/mpp.json', expectStatus: 200 },
    { name: 'agent_manifest', method: 'GET', path: '/.well-known/clawdmarket.json', expectStatus: 200 },
    { name: 'agents_list_free', method: 'GET', path: '/api/agents/list', expectStatus: 200 },
    { name: 'agents_search_free', method: 'GET', path: '/api/agents/search?q=web%20research', expectStatus: 200 },
    { name: 'capabilities_resolve_free', method: 'GET', path: '/api/capabilities/resolve?q=web%20search', expectStatus: 200 },
    { name: 'tasks_free', method: 'GET', path: '/api/tasks?status=open&limit=1', expectStatus: 200 },
    { name: 'agents_register_free_validation', method: 'POST', path: '/api/agents/register', body: '{}', expectStatus: 400 },
    { name: 'trades_auth_required', method: 'POST', path: '/api/trades', body: '{}', expectStatus: 401 },
    { name: 'messages_payment_or_auth_required', method: 'GET', path: '/api/messages', expectStatus: 402 },
    { name: 'ratings_payment_or_auth_required', method: 'POST', path: '/api/ratings', body: '{}', expectStatus: 402 },
    { name: 'webhooks_validation_or_auth_required', method: 'POST', path: '/api/webhooks', body: '{}', expectStatus: 400 },
    { name: 'mpp_session_create_passthrough_health', method: 'POST', path: '/api/mpp/session/create', body: '{}', expectStatus: 200 },
    { name: 'mcp_tools_list_free', method: 'POST', path: '/api/mcp', body: '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}', expectStatus: 200 },
    { name: 'price_oracle', method: 'GET', path: '/api/price?tokenAddress=native&chainId=1&usdAmount=0.01&decimals=18', expectStatus: 200 },
    { name: 'btc_price', method: 'GET', path: '/api/payments/bitcoin/price', expectStatus: 200 },
    { name: 'sol_price', method: 'GET', path: '/api/payments/solana/price', expectStatus: 200 },
    { name: 'root_indexable', method: 'GET', path: '/', expectStatus: 200, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } },
    { name: 'observe_public', method: 'GET', path: '/observe', expectStatus: 200, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } },
    { name: 'docs_public', method: 'GET', path: '/docs', expectStatus: 200, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } },
  ]

  const baseUrl = new URL(req.url).origin

  const results = await Promise.allSettled(
    checks.map(async (check) => {
      const start = Date.now()
      try {
        const res = await fetch(`${baseUrl}${check.path}`, {
          method: check.method,
          headers: { 'Content-Type': 'application/json', ...(check.headers || {}) },
          body: check.body,
          redirect: 'manual',
        })
        const latency = Date.now() - start
        const passed = res.status === check.expectStatus
        return { name: check.name, status: res.status, expected: check.expectStatus, passed, latency, path: check.path }
      } catch (err: any) {
        return { name: check.name, status: 0, expected: check.expectStatus, passed: false, error: err.message, path: check.path }
      }
    }),
  )

  const checks_results = results.map((r) => (r.status === 'fulfilled' ? r.value : (r as any).reason))
  const all_passed = checks_results.every((r: any) => r.passed)
  const passed_count = checks_results.filter((r: any) => r.passed).length

  return NextResponse.json(
    {
      status: all_passed ? 'ok' : 'degraded',
      passed: passed_count,
      total: checks_results.length,
      timestamp: new Date().toISOString(),
      checks: checks_results,
    },
    { status: 200 },
  )
}
