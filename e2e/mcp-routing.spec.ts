import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('MCP HTTP negotiates Tasks and recovers a private plan before safe terminal cancellation', async ({ request }) => {
  const preflight = await request.fetch('/api/mcp', { method: 'OPTIONS', headers: {
    Origin: 'https://www.clawdmkt.com', 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Authorization, MCP-Protocol-Version, Last-Event-ID',
  } })
  expect(preflight.status()).toBe(200)
  expect(preflight.headers()['access-control-allow-headers']).toContain('MCP-Protocol-Version')
  expect(preflight.headers()['access-control-allow-headers']).toContain('Last-Event-ID')
  expect((await request.fetch('/api/mcp', { method: 'OPTIONS', headers: { Origin: 'https://attacker.invalid' } })).status()).toBe(403)
  const registered = await request.post('/api/agents/register', {
    headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65535).toString(16)}::ca1` },
    data: { name: `MCP HTTP ${randomUUID().slice(0, 8)}`, description: 'Isolated MCP HTTP fixture', capabilities: ['code-review'], activation_mode: 'autonomous' },
  })
  expect(registered.status()).toBe(201)
  const agent = (await registered.json()).agent
  const headers = { Authorization: `Bearer ${agent.api_key}`, Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }
  const rpc = (method: string, params: unknown) => request.post('/api/mcp', { headers, data: { jsonrpc: '2.0', id: randomUUID(), method, params } })
  const initialized = await rpc('initialize', { protocolVersion: '2025-11-25' })
  expect((await initialized.json()).result.capabilities.tasks.requests.tools.call).toEqual({})
  const input = { name: 'route_work', arguments: { client_reference: `http-${randomUUID()}`, request: {
    objective: 'Review a private repository for authentication flaws', required_capabilities: ['code-review'], max_budget: { amount: '0.01', currency: 'USD' },
  } }, task: {} }
  const created = await rpc('tools/call', input)
  expect(created.status()).toBe(200)
  const task = (await created.json()).result.task
  expect(task.status).toBe('input_required')
  expect(task.ttl).toBeNull()
  expect((await (await rpc('tools/call', input)).json()).result.task.taskId).toBe(task.taskId)
  const inspected = await rpc('tools/call', { name: 'get_route_task', arguments: { task_id: task.taskId } })
  expect(inspected.headers()['cache-control']).toContain('private, no-store')
  const data = (await inspected.json()).result.structuredContent
  expect(data.next_action).toBe('owner_authorize_then_continue')
  expect(data.funds_state).toBe('no_funds_moved')
  const anonymous = await request.post('/api/mcp', { headers: { Accept: headers.Accept, 'MCP-Protocol-Version': headers['MCP-Protocol-Version'] }, data: { jsonrpc: '2.0', id: 1, method: 'tasks/get', params: { taskId: task.taskId } } })
  expect(anonymous.status()).toBe(401)
  const resultId = randomUUID()
  const pending = await request.post('/api/mcp', { headers, data: { jsonrpc: '2.0', id: resultId, method: 'tasks/result', params: { taskId: task.taskId } } })
  expect(pending.headers()['content-type']).toContain('text/event-stream')
  const pendingFrames = await pending.text()
  expect(pendingFrames).not.toContain('"result"')
  const cursor = /id: ([^\n]+)/.exec(pendingFrames)?.[1]
  if (!cursor) throw new Error('Pending MCP result did not provide a durable SSE cursor')
  expect((await (await rpc('tasks/cancel', { taskId: task.taskId })).json()).result.status).toBe('cancelled')
  const resumed = await request.get('/api/mcp', { headers: { ...headers, 'Last-Event-ID': cursor } })
  const resultFrames = await resumed.text()
  expect(resultFrames).toContain(`"id":"${resultId}"`)
  expect(resultFrames).toContain('"status":"cancelled"')
  const result = (await (await rpc('tasks/result', { taskId: task.taskId })).json()).result
  expect(result.isError).toBe(true)
  expect(result._meta['io.modelcontextprotocol/related-task'].taskId).toBe(task.taskId)
  expect((await (await rpc('tasks/list', {})).json()).result.tasks.some((item: { taskId: string }) => item.taskId === task.taskId)).toBe(true)
})
