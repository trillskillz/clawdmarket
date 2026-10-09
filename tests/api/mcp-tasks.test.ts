import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NextRequest } from 'next/server';
import { privateKeyToAccount } from 'viem/accounts';
import { eq, sql } from 'drizzle-orm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createLocalTestSchema } from '../helpers/local-schema';

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema');
let mcp: typeof import('@/app/api/mcp/route');
let jwt: typeof import('@/lib/auth').generateJWT;
let baseUrl = 'http://127.0.0.1', resumedGets = 0;
const server = createServer();
const treasury = privateKeyToAccount(`0x${'99'.repeat(32)}`).address.toLowerCase();
const token = `0x${'44'.repeat(20)}`;
const policy = { required: true, methods: ['buyer_review', 'schema'], acceptance: { version: 1, mode: 'explicit_buyer' } };
const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' };
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-mcp-tasks-'));
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'mcp.db')}`;
  process.env.JWT_SECRET = 'mcp-tasks-test-only';
  process.env.WEBHOOK_SECRET_KEY = 'mcp-tasks-test-only';
  process.env.TREASURY_ADDRESS = treasury;
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'99'.repeat(32)}`;
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Test Base', address: token, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl: 'https://rpc.example.invalid' }]);
  process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED = 'true';
  process.env.CLAWDMARKET_ROUTE_EXECUTION_ENABLED = 'true';
  process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED = 'true';
  db = (await import('@/lib/db')).db;
  schema = await import('@/lib/schema');
  await createLocalTestSchema(db.$client, schema);
  mcp = await import('@/app/api/mcp/route');
  jwt = (await import('@/lib/auth')).generateJWT;
  server.on('request', async (incoming, outgoing) => {
    const controller = new AbortController();
    outgoing.on('close', () => controller.abort());
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString();
      const request = new NextRequest(`${baseUrl}/api/mcp`, { method: incoming.method, headers: incoming.headers as Record<string, string>,
        signal: controller.signal, ...(text ? { body: text } : {}) });
      if (incoming.method === 'GET' && incoming.headers['last-event-id']) resumedGets++;
      const response = incoming.method === 'GET' ? await mcp.GET(request) : await mcp.POST(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(outgoing);
      else outgoing.end();
    } catch { if (!outgoing.headersSent) outgoing.writeHead(500); outgoing.end('{}'); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); db?.$client.close(); rmSync(directory, { recursive: true, force: true }); });
async function rpc(key: string | undefined, method: string, params: unknown, id: string | number = randomUUID()) {
  const response = await mcp.POST(new NextRequest(`${baseUrl}/api/mcp`, { method: 'POST', headers: { ...headers, ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) }));
  return { response, body: response.headers.get('content-type')?.includes('text/event-stream') ? null : await response.json() };
}
async function fixture(scopes: Array<'agent:read' | 'marketplace:write' | 'payments:write'> = ['agent:read', 'marketplace:write', 'payments:write']) {
  const agent = randomUUID(), buyer = `user_agent_${agent}`, owner = `owner-${agent}`, seller = `seller-${agent}`, service = randomUUID();
  await db.insert(schema.users).values([buyer, owner, seller].map(id => ({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'human' as const })));
  await db.insert(schema.agents).values({ id: agent, name: 'MCP Buyer', description: 'Isolated MCP task fixture', capabilities: '["code-review"]', endpoint: 'https://example.invalid', owner_address: '', api_key: `unused-${agent}` });
  await db.insert(schema.agent_owners).values({ agentId: agent, userId: owner, establishedBy: 'test' });
  const credentials = await (await import('@/lib/agent-named-credentials')).createNamedAgentCredential({ agentId: agent, name: 'MCP fixture', scopes, actorCredentialId: null });
  assert.equal(credentials.kind, 'created'); if (credentials.kind !== 'created') throw Error('fixture key');
  await db.insert(schema.payout_addresses).values({ user_id: seller, address: treasury });
  await db.insert(schema.service_definitions).values({ id: service, seller_id: seller, title: 'MCP review', description: 'Private review with explicit buyer acceptance', capabilities: '["code-review"]', price_minor: 100, status: 'active', estimated_latency_seconds: 30, max_concurrency: 1, provider_protocol: 'leased_v1', output_schema: '{"type":"object","properties":{"result":{"type":"string"}}}', verification_policy: JSON.stringify(policy) });
  const request = { objective: 'Review private code with explicit buyer acceptance', required_capabilities: ['code-review'], input: { private_text: 'fixture secret' }, max_budget: { amount: '5.00', currency: 'USD' }, verification: policy, provider_requirements: { approved_providers: [seller] }, payment_policy: { allowed_rails: ['evm'] } };
  return { agent, buyer, owner, seller, service, key: credentials.api_key, credentialId: credentials.id, request };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function start(f: Fixture) {
  const params = { name: 'route_work', arguments: { client_reference: `mcp-${randomUUID()}`, request: f.request }, task: { ttl: 1 } };
  const result = await rpc(f.key, 'tools/call', params);
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  const task = result.body.result.task, route = JSON.parse(task.statusMessage).route_id as string;
  assert.equal(task.status, 'input_required'); assert.equal(task.ttl, null);
  assert.equal(result.body.result.content, undefined);
  return { params, task, route };
}
async function mandate(f: Fixture, route: string) {
  const ownerKey = jwt({ userId: f.owner, email: `${f.owner}@test.invalid`, role: 'human' });
  const response = await (await import('@/app/api/routes/[id]/mandate/route')).POST(new NextRequest(`${baseUrl}/api/routes/${route}/mandate`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: 1, client_reference: `mandate-${randomUUID()}`, max_aggregate: '2.00', max_per_execution: '2.00', max_retry_budget: '0.00', max_attempts: 1, approved_providers: [f.seller], max_latency_seconds: 60, private_data: 'selected_provider_only', expires_at: new Date(Date.now() + 600000).toISOString(), payment: { rail: 'evm', chain_id: 8453, token_address: token, payer_address: privateKeyToAccount(`0x${'11'.repeat(32)}`).address.toLowerCase(), treasury_address: treasury, minimum_token_reserve_units: '5000000', minimum_native_reserve_wei: '1000000', max_gas_cost_wei: '1000000000000' } }),
  }), { params: Promise.resolve({ id: route }) });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json())); return (await response.json()).mandate;
}

test('MCP negotiates Tasks only for the supported version and preserves legacy discovery/payment calls', async () => {
  const latest = await rpc(undefined, 'initialize', { protocolVersion: '2025-11-25' });
  assert.equal(latest.body.result.protocolVersion, '2025-11-25'); assert.ok(latest.body.result.capabilities.tasks.requests.tools.call);
  const legacy = await rpc(undefined, 'initialize', { protocolVersion: '2024-11-05' });
  assert.equal(legacy.body.result.protocolVersion, '2024-11-05'); assert.equal(legacy.body.result.capabilities.tasks, undefined);
  const tools = (await rpc(undefined, 'tools/list', {})).body.result.tools;
  assert.equal(tools.find((tool: any) => tool.name === 'route_work').execution.taskSupport, 'required');
  assert.equal((await mcp.GET(new NextRequest(`${baseUrl}/api/mcp`, { headers: { Accept: 'text/event-stream' } }))).status, 405);
  const initialized = await mcp.POST(new NextRequest(`${baseUrl}/api/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }));
  assert.equal(initialized.status, 202); assert.equal(await initialized.text(), '');
});
test('MCP rejects hostile origins, unsupported versions, malformed JSON, batches and oversized streamed bodies', async () => {
  for (const method of ['GET', 'POST', 'OPTIONS'] as const) {
    const response = await mcp[method](new NextRequest(`${baseUrl}/api/mcp`, { method, headers: { ...headers, Origin: 'https://attacker.invalid' }, ...(method === 'POST' ? { body: '{}' } : {}) }));
    assert.equal(response.status, 403);
  }
  for (const [body, status] of [['{', 400], ['[]', 400], ['x'.repeat(17000), 413]] as const) {
    const response = await mcp.POST(new NextRequest(`${baseUrl}/api/mcp`, { method: 'POST', headers, body })); assert.equal(response.status, status);
  }
  assert.equal((await mcp.POST(new NextRequest(`${baseUrl}/api/mcp`, { method: 'POST', headers: { ...headers, 'MCP-Protocol-Version': '2099-01-01' }, body: '{}' }))).status, 400);
});
test('MCP checks every write scope, task augmentation and agent bearer authority before persisting intent', async () => {
  const f = await fixture();
  const args = { client_reference: `auth-${randomUUID()}`, request: f.request };
  for (const key of [undefined, jwt({ userId: f.owner, email: 'owner@test.invalid', role: 'human' })]) {
    assert.equal((await rpc(key, 'tools/call', { name: 'route_work', arguments: args, task: {} })).response.status, 401);
  }
  for (const scopes of [['agent:read'], ['agent:read', 'marketplace:write'], ['agent:read', 'payments:write'], ['marketplace:write', 'payments:write']] as const) {
    const limited = await fixture([...scopes]);
    assert.equal((await rpc(limited.key, 'tools/call', { name: 'route_work', arguments: { ...args, request: limited.request }, task: {} })).response.status, 403);
  }
  const missingTask = await rpc(f.key, 'tools/call', { name: 'route_work', arguments: args });
  assert.equal(missingTask.response.status, 400);
  assert.equal(missingTask.body.error.code, -32601);
  const forbiddenTask = await rpc(f.key, 'tools/call', { name: 'plan_work', arguments: {}, task: {} });
  assert.equal(forbiddenTask.body.error.code, -32601);
  assert.equal((await db.select().from(schema.mcp_route_tasks)).length, 0);
});
test('MCP persists one task and route under concurrent replay, ignores JSON-RPC IDs and rejects changed intent', async () => {
  const f = await fixture(), s = await start(f);
  const replay = await Promise.all([rpc(f.key, 'tools/call', s.params, 'other-rpc-id'), rpc(f.key, 'tools/call', s.params)]);
  replay.forEach(result => assert.equal(result.body.result.task.taskId, s.task.taskId));
  const changed = await rpc(f.key, 'tools/call', { ...s.params, arguments: { ...s.params.arguments, request: { ...f.request, objective: 'Replace the saved objective' } } });
  assert.equal(changed.response.status, 409);
  assert.equal((await db.select().from(schema.route_plans).where(eq(schema.route_plans.buyer_id, f.buyer))).length, 1);
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer))).length, 0);
  assert.equal((await db.select().from(schema.a2a_route_tasks).where(eq(schema.a2a_route_tasks.agent_id, f.agent))).length, 0);
  const a2aRead = await (await import('@/app/api/a2a/route')).POST(new NextRequest(`${baseUrl}/api/a2a`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${f.key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'GetTask', params: { id: s.task.taskId } }) }));
  assert.equal(a2aRead.status, 404);
});
test('MCP owner mandate continuation reserves once and refuses cancellation after unpaid checkout', async () => {
  const f = await fixture(), s = await start(f), m = await mandate(f, s.route);
  const params = { name: 'continue_route', arguments: { task_id: s.task.taskId, mandate_id: m.id, client_reference: `continue-${randomUUID()}` } };
  const results = await Promise.all([rpc(f.key, 'tools/call', params), rpc(f.key, 'tools/call', params)]);
  results.forEach(result => { assert.equal(result.response.status, 200, JSON.stringify(result.body)); assert.equal(result.body.result.structuredContent.task.status, 'input_required'); });
  const trades = await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer));
  assert.equal(trades.length, 1); assert.equal(trades[0].status, 'pending');
  assert.equal((await rpc(f.key, 'tasks/cancel', { taskId: s.task.taskId })).response.status, 409);
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer)))[0].status, 'pending');
  const other = await fixture();
  for (const method of ['tasks/get', 'tasks/result', 'tasks/cancel']) assert.equal((await rpc(other.key, method, { taskId: s.task.taskId })).response.status, 404);
  assert.equal((await rpc(other.key, 'tasks/list', {})).body.result.tasks.length, 0);
});
test('MCP terminal cancellation is sticky, rejects repeat cancellation, and survives production closure', async () => {
  const f = await fixture(), s = await start(f), previous = process.env.NODE_ENV;
  try {
    Object.assign(process.env, { NODE_ENV: 'production', CLAWDMARKET_MCP_ROUTING_WRITES_ENABLED: 'false' });
    assert.equal((await rpc(f.key, 'tools/call', { ...s.params, arguments: { ...s.params.arguments, client_reference: `closed-${randomUUID()}` } })).response.status, 503);
    assert.equal((await rpc(f.key, 'tools/call', s.params)).body.result.task.taskId, s.task.taskId);
    const cancelled = await rpc(f.key, 'tasks/cancel', { taskId: s.task.taskId });
    assert.equal(cancelled.body.result.status, 'cancelled');
    assert.equal((await rpc(f.key, 'tasks/cancel', { taskId: s.task.taskId })).body.error.code, -32602);
    const result = (await rpc(f.key, 'tasks/result', { taskId: s.task.taskId })).body.result;
    assert.equal(result.isError, true); assert.equal(result._meta['io.modelcontextprotocol/related-task'].taskId, s.task.taskId);
    await db.update(schema.route_plans).set({ state: 'planned' }).where(eq(schema.route_plans.id, s.route));
    assert.equal((await rpc(f.key, 'tasks/get', { taskId: s.task.taskId })).body.result.status, 'cancelled');
  } finally { Object.assign(process.env, { NODE_ENV: previous }); delete process.env.CLAWDMARKET_MCP_ROUTING_WRITES_ENABLED; }
});
test('MCP incomplete intent recovers its original route in a fresh application process', async () => {
  const f = await fixture(), s = await start(f);
  await db.update(schema.mcp_route_tasks).set({ route_id: null }).where(eq(schema.mcp_route_tasks.id, s.task.taskId));
  const script = `const {NextRequest}=await import('next/server.js'); const {POST}=await import('./app/api/mcp/route.ts');
    const response=await POST(new NextRequest('http://localhost/api/mcp',{method:'POST',headers:JSON.parse(process.env.MCP_TEST_HEADERS),body:process.env.MCP_TEST_BODY}));
    process.stdout.write(JSON.stringify({status:response.status,body:await response.json()}));`;
  const child = await promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e', script], {
    env: { ...process.env, MCP_TEST_HEADERS: JSON.stringify({ ...headers, Authorization: `Bearer ${f.key}` }), MCP_TEST_BODY: JSON.stringify({ jsonrpc: '2.0', id: 'restarted', method: 'tools/call', params: s.params }) },
  });
  const resumed = JSON.parse(child.stdout); assert.equal(resumed.status, 200, child.stdout);
  assert.equal(resumed.body.result.task.taskId, s.task.taskId); assert.equal(JSON.parse(resumed.body.result.task.statusMessage).route_id, s.route);
  assert.equal((await db.select().from(schema.route_plans).where(eq(schema.route_plans.buyer_id, f.buyer))).length, 1);
});
test('MCP SSE waits for terminal state, resumption keeps its original RPC ID and foreign cursors remain private', async () => {
  const f = await fixture(), other = await fixture(), s = await start(f);
  const pending = await rpc(f.key, 'tasks/result', { taskId: s.task.taskId }, 'original-result-request');
  assert.match(pending.response.headers.get('content-type') || '', /text\/event-stream/);
  const reader = pending.response.body!.getReader();
  const frame = new TextDecoder().decode((await reader.read()).value); assert.equal(frame.includes('"result"'), false);
  const cursor = /id: ([^\n]+)/.exec(frame)![1]; await reader.cancel();
  assert.equal((await rpc(f.key, 'tasks/get', { taskId: s.task.taskId })).body.result.status, 'input_required');
  const resumeRequest = (key: string) => new NextRequest(`${baseUrl}/api/mcp`, { headers: { ...headers, Authorization: `Bearer ${key}`, 'Last-Event-ID': cursor } });
  assert.equal((await mcp.GET(resumeRequest(other.key))).status, 404);
  const resumed = await mcp.GET(resumeRequest(f.key));
  assert.equal((await rpc(f.key, 'tasks/cancel', { taskId: s.task.taskId })).body.result.status, 'cancelled');
  const response = await resumed.text();
  assert.match(response, /"id":"original-result-request"/); assert.match(response, /"status":"cancelled"/);
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer))).length, 0);
});
test('MCP SDK initializes, creates and polls Tasks, resumes SSE automatically, retrieves results and cancels', async () => {
  const f = await fixture(), client = new Client({ name: 'clawdmarket-task-fixture', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${f.key}` } } }));
  try {
    await client.listTools();
    const stream = client.experimental.tasks.callToolStream({ name: 'route_work', arguments: { client_reference: `sdk-${randomUUID()}`, request: f.request } }, CallToolResultSchema, { task: { ttl: 1 } });
    const created = await stream.next(); assert.equal(created.value?.type, 'taskCreated');
    if (!created.value || created.value.type !== 'taskCreated') throw Error('SDK task creation failed');
    const taskId = created.value.task.taskId; await stream.return();
    assert.equal((await client.experimental.tasks.getTask(taskId)).status, 'input_required');
    assert.ok((await client.experimental.tasks.listTasks()).tasks.some(task => task.taskId === taskId));
    const beforeGets = resumedGets;
    const pending = client.experimental.tasks.getTaskResult(taskId, CallToolResultSchema, { timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 17000));
    assert.ok(resumedGets > beforeGets, 'SDK did not resume the server-closed SSE connection');
    assert.equal((await client.experimental.tasks.cancelTask(taskId)).status, 'cancelled');
    assert.equal((await pending).isError, true);
  } finally { await client.close(); }
});
test('MCP list cursors page every owned task and retained handles survive TTL requests and the task cap', async () => {
  const f = await fixture(), s = await start(f), now = Math.floor(Date.now() / 1000);
  await db.insert(schema.mcp_route_tasks).values(Array.from({ length: 99 }, (_, i) => ({ agent_id: f.agent, context_id: randomUUID(), first_message_id: `retained-${i}`, initial_message: '{}', action: 'route_work' as const, route_id: s.route, created_at: now - i - 10, updated_at: now })));
  const all = new Set<string>(); let cursor: string | undefined;
  do { const page = (await rpc(f.key, 'tasks/list', { ...(cursor ? { cursor } : {}) })).body.result;
    page.tasks.forEach((task: any) => all.add(task.taskId)); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(all.size, 100);
  assert.equal((await rpc(f.key, 'tools/call', { ...s.params, arguments: { ...s.params.arguments, client_reference: `cap-${randomUUID()}` } })).response.status, 429);
  assert.equal((await rpc(f.key, 'tools/call', s.params)).body.result.task.taskId, s.task.taskId);
  assert.equal((await rpc(f.key, 'tasks/list', { cursor: 'invalid-cursor' })).body.error.code, -32602);
  await db.run(sql`UPDATE mcp_result_streams SET expires_at=1 WHERE agent_id=${f.agent}`);
});
