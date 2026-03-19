import { NextResponse } from 'next/server'

type Check = {
  name: string
  method: 'GET' | 'POST'
  path: string
  expectStatus: number
  headers?: Record<string, string>
  body?: string
}

export async function GET() {
  const checks: Check[] = [
    { name: 'health', method: 'GET', path: '/api/health', expectStatus: 200 },
    { name: 'stats', method: 'GET', path: '/api/stats', expectStatus: 200 },
    { name: 'capabilities', method: 'GET', path: '/api/capabilities', expectStatus: 200 },
    { name: 'leaderboard', method: 'GET', path: '/api/leaderboard', expectStatus: 200 },
    { name: 'activity', method: 'GET', path: '/api/activity', expectStatus: 200 },
    { name: 'mpp_json', method: 'GET', path: '/api/.well-known/mpp.json', expectStatus: 200 },
    { name: 'agents_gated', method: 'GET', path: '/api/agents', expectStatus: 402 },
    { name: 'agents_register_gated', method: 'POST', path: '/api/agents/register', expectStatus: 402 },
    { name: 'trades_gated', method: 'POST', path: '/api/trades', expectStatus: 402 },
    { name: 'messages_gated', method: 'GET', path: '/api/messages', expectStatus: 402 },
    { name: 'ratings_gated', method: 'POST', path: '/api/ratings', expectStatus: 402 },
    { name: 'webhooks_gated', method: 'POST', path: '/api/webhooks', expectStatus: 402 },
    { name: 'mpp_session_create_gated', method: 'POST', path: '/api/mpp/session/create', expectStatus: 402 },
    { name: 'mcp_tools_list_free', method: 'POST', path: '/api/mcp', body: '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}', expectStatus: 200 },
    { name: 'price_oracle', method: 'GET', path: '/api/price?tokenAddress=native&chainId=1&usdAmount=0.01&decimals=18', expectStatus: 200 },
    { name: 'btc_price', method: 'GET', path: '/api/payments/bitcoin/price', expectStatus: 200 },
    { name: 'sol_price', method: 'GET', path: '/api/payments/solana/price', expectStatus: 200 },
    { name: 'middleware_browser_redirect', method: 'GET', path: '/', expectStatus: 307, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } },
    { name: 'observe_public', method: 'GET', path: '/observe', expectStatus: 200, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } },
    { name: 'docs_public', method: 'GET', path: '/docs', expectStatus: 200, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } },
  ]

  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'

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
    { status: all_passed ? 200 : 207 },
  )
}
