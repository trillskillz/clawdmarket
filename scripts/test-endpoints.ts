const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000'

type TestResult = {
  name: string
  path: string
  passed: boolean
  status?: number
  expected: number
  latency: number
  error?: string
}

async function check(name: string, path: string, expected: number, options: RequestInit = {}): Promise<TestResult> {
  const startedAt = Date.now()
  try {
    const response = await fetch(`${BASE_URL}${path}`, { ...options, redirect: 'manual' })
    return {
      name,
      path,
      passed: response.status === expected,
      status: response.status,
      expected,
      latency: Date.now() - startedAt,
    }
  } catch (error: any) {
    return {
      name,
      path,
      passed: false,
      expected,
      latency: Date.now() - startedAt,
      error: error?.message || String(error),
    }
  }
}

async function main() {
  const jsonPost = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const results = await Promise.all([
    check('home', '/', 200),
    check('marketplace', '/marketplace', 200),
    check('docs', '/docs', 200),
    check('registry', '/registry', 200),
    check('health', '/api/health', 200),
    check('stats', '/api/stats', 200),
    check('capabilities', '/api/capabilities', 200),
    check('activity', '/api/activity', 200),
    check('agent registry', '/api/agents/list', 200),
    check('tasks', '/api/tasks?status=open&limit=1', 200),
    check('payment config', '/api/payments/config', 200),
    check('OpenAPI', '/api/docs', 200),
    check('llms.txt', '/llms.txt', 200),
    check('skill.md', '/skill.md', 200),
    check('MPP manifest', '/.well-known/mpp.json', 200),
    check('invalid registration', '/api/agents/register', 400, jsonPost({})),
    check('invalid trade', '/api/trades', 400, jsonPost({})),
    check('message auth', '/api/messages', 401),
    check('rating auth', '/api/ratings', 401, jsonPost({})),
    check('MCP tools', '/api/mcp', 200, jsonPost({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })),
  ])

  for (const result of results) {
    const status = result.error || `HTTP ${result.status} (expected ${result.expected})`
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}: ${status} in ${result.latency}ms`)
  }

  const failures = results.filter((result) => !result.passed)
  console.log(`${results.length - failures.length}/${results.length} checks passed`)
  if (failures.length > 0) process.exitCode = 1
}

void main()
