const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000'

interface TestResult {
 name: string
 path: string
 passed: boolean
 status?: number
 expected: number
 latency: number
 error?: string
 detail?: string
}

async function check(
 name: string,
 path: string,
 expectedStatus: number,
 options: RequestInit & { headers?: Record<string, string> } = {},
): Promise<TestResult> {
 const start = Date.now()
 try {
 const res = await fetch(`${BASE_URL}${path}`, {
 ...options,
 redirect: 'manual',
 })
 const latency = Date.now() - start
 const passed = res.status === expectedStatus
 let detail = ''
 if (passed && res.status === 200) {
 try {
 const body = await res.json()
 detail = JSON.stringify(body).slice(0, 100)
 } catch {}
 }
 return { name, path, passed, status: res.status, expected: expectedStatus, latency, detail }
 } catch (err: any) {
 return { name, path, passed: false, expected: expectedStatus, latency: Date.now() - start, error: err.message }
 }
}

async function runAll() {
 console.log(`\n🧪 ClawdMarket API Test Suite`)
 console.log(`📡 Target: ${BASE_URL}`)
 console.log(`⏰ ${new Date().toISOString()}\n`)

 const results: TestResult[] = []

 console.log('── FREE ENDPOINTS ──')
 results.push(await check('health', '/api/health', 200))
 results.push(await check('stats', '/api/stats', 200))
 results.push(await check('capabilities', '/api/capabilities', 200))
 results.push(await check('leaderboard', '/api/leaderboard', 200))
 results.push(await check('activity', '/api/activity', 200))
 results.push(await check('mpp_json', '/api/.well-known/mpp.json', 200))
 results.push(await check('price_oracle_eth', '/api/price?tokenAddress=native&chainId=1&usdAmount=0.01&decimals=18', 200))
 results.push(await check('btc_price', '/api/payments/bitcoin/price', 200))
 results.push(await check('sol_price', '/api/payments/solana/price', 200))
 results.push(await check('ratings_list', '/api/ratings?agent_id=test', 200))
 results.push(await check('health_full', '/api/health/full', 200))

 console.log('\n── MPP GATED (expect 402) ──')
 results.push(await check('agents_gated', '/api/agents', 402))
 results.push(await check('agents_register_gated', '/api/agents/register', 402, { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' }))
 results.push(await check('trades_gated', '/api/trades', 402, { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' }))
 results.push(await check('messages_read_gated', '/api/messages', 402))
 results.push(await check('messages_send_gated', '/api/messages', 402, { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' }))
 results.push(await check('ratings_post_gated', '/api/ratings', 402, { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' }))
 results.push(await check('webhooks_create_gated', '/api/webhooks', 402, { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' }))
 results.push(await check('webhooks_list_gated', '/api/webhooks', 402))
 results.push(await check('mpp_session_create_gated', '/api/mpp/session/create', 402, { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' }))

 console.log('\n── MCP ENDPOINTS ──')
 results.push(await check('mcp_tools_list_free', '/api/mcp', 200, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
 }))
 results.push(await check('mcp_tools_call_gated', '/api/mcp', 402, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_agents', arguments: {} } })
 }))

 console.log('\n── MIDDLEWARE ──')
 results.push(await check('root_redirects_browser', '/', 307, { headers: { 'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/120' } }))
 results.push(await check('root_allows_agent', '/', 200, { headers: { 'User-Agent': 'curl/7.88.0' } }))
 results.push(await check('observe_allows_browser', '/observe', 200, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } }))
 results.push(await check('docs_allows_browser', '/docs', 200, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } }))
 results.push(await check('registry_allows_browser', '/registry', 200, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } }))

 console.log('\n── PAYMENT ENDPOINTS ──')
 results.push(await check('payments_evm_exists', '/api/payments/evm', 400, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ txHash: '0x0', chainId: 1, tokenAddress: 'native', route: '/test', amountUsd: 0.01 })
 }))
 results.push(await check('payments_solana_exists', '/api/payments/solana', 400, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ signature: 'fake', route: '/test', amount_usd: 0.01 })
 }))
 results.push(await check('payments_bitcoin_exists', '/api/payments/bitcoin', 400, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ txid: 'fake', route: '/test', amount_usd: 0.01 })
 }))

 console.log('\n── RESULTS ──')
 const passed = results.filter(r => r.passed)
 const failed = results.filter(r => !r.passed)

 results.forEach(r => {
 const icon = r.passed ? '✅' : '❌'
 const latency = `${r.latency}ms`
 const status = r.error ? `ERROR: ${r.error}` : `HTTP ${r.status} (expected ${r.expected})`
 console.log(`${icon} ${r.name.padEnd(35)} ${status.padEnd(30)} ${latency}`)
 })

 console.log(`\n📊 ${passed.length}/${results.length} passed`)

 if (failed.length > 0) {
 console.log('\n❌ FAILURES:')
 failed.forEach(r => {
 console.log(` ${r.name}: got HTTP ${r.status}, expected ${r.expected}${r.error ? ' — ' + r.error : ''}`)
 })
 process.exit(1)
 } else {
 console.log('\n🎉 All checks passed!')
 process.exit(0)
 }
}

runAll()
