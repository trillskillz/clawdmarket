import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NextRequest } from 'next/server';
import { privateKeyToAccount } from 'viem/accounts';
import { eq, sql } from 'drizzle-orm';
import { createLocalTestSchema } from '../helpers/local-schema';
let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema');
let a2a: typeof import('@/app/api/a2a/route').POST;
let jwt: typeof import('@/lib/auth').generateJWT;
const treasury = privateKeyToAccount(`0x${'99'.repeat(32)}`).address.toLowerCase();
const token = `0x${'44'.repeat(20)}`;
const policy = { required: true, methods: ['buyer_review', 'schema'], acceptance: { version: 1, mode: 'explicit_buyer' } };
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-a2a-write-'));
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'a2a.db')}`;
  process.env.JWT_SECRET = 'a2a-write-test-only';
  process.env.WEBHOOK_SECRET_KEY = 'a2a-write-test-only';
  process.env.TREASURY_ADDRESS = treasury;
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'99'.repeat(32)}`;
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Test Base', address: token, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl: 'https://rpc.example.invalid' }]);
  process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED = 'true';
  process.env.CLAWDMARKET_ROUTE_EXECUTION_ENABLED = 'true';
  process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED = 'true';
  db = (await import('@/lib/db')).db;
  schema = await import('@/lib/schema');
  await createLocalTestSchema(db.$client, schema);
  a2a = (await import('@/app/api/a2a/route')).POST;
  jwt = (await import('@/lib/auth')).generateJWT;
});
after(() => { db?.$client.close(); rmSync(directory, { recursive: true, force: true }); });
const message = (data: unknown, extra: Record<string, unknown> = {}) => ({ role: 'ROLE_USER', messageId: randomUUID(), parts: [{ data, mediaType: 'application/json' }], ...extra });
async function rpc(key: string, method: string, params: unknown) {
  const response = await a2a(new NextRequest('https://clawdmkt.test/api/a2a', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }));
  return { response, body: await response.json() };
}
async function fixture(scopes: Array<'agent:read' | 'marketplace:write' | 'payments:write'> = ['agent:read', 'marketplace:write', 'payments:write']) {
  const agent = randomUUID(), buyer = `user_agent_${agent}`, owner = `owner-${agent}`, seller = `seller-${agent}`, service = randomUUID();
  await db.insert(schema.users).values([buyer, owner, seller].map(id => ({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'human' as const })));
  await db.insert(schema.agents).values({ id: agent, name: 'A2A Buyer', description: 'Isolated authenticated route fixture', capabilities: '["code-review"]', endpoint: 'https://example.invalid', owner_address: '', api_key: `unused-${agent}` });
  await db.insert(schema.agent_owners).values({ agentId: agent, userId: owner, establishedBy: 'test' });
  const credentials = await (await import('@/lib/agent-named-credentials')).createNamedAgentCredential({ agentId: agent, name: 'A2A fixture', scopes, actorCredentialId: null });
  assert.equal(credentials.kind, 'created');
  if (credentials.kind !== 'created')
    throw Error('fixture key');
  await db.insert(schema.payout_addresses).values({ user_id: seller, address: treasury });
  await db.insert(schema.service_definitions).values({ id: service, seller_id: seller, title: 'A2A review', description: 'Private review with explicit buyer acceptance', capabilities: '["code-review"]', price_minor: 100, status: 'active', estimated_latency_seconds: 30, max_concurrency: 1, provider_protocol: 'leased_v1', output_schema: '{"type":"object","properties":{"result":{"type":"string"}}}', verification_policy: JSON.stringify(policy) });
  const request = { objective: 'Review private code with explicit buyer acceptance', required_capabilities: ['code-review'], input: { private_text: 'fixture secret' }, max_budget: { amount: '5.00', currency: 'USD' }, verification: policy, provider_requirements: { approved_providers: [seller] }, payment_policy: { allowed_rails: ['evm'] } };
  return { agent, buyer, owner, seller, service, key: credentials.api_key, request };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function start(f: Fixture) {
  const input = message({ action: 'route_work', request: f.request }), result = await rpc(f.key, 'SendMessage', { message: input });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return { input, task: result.body.result.task, route: result.body.result.task.artifacts[0].parts[0].data.route_id };
}
async function mandate(f: Fixture, route: string, overrides: Record<string, unknown> = {}) {
  const ownerKey = jwt({ userId: f.owner, email: `${f.owner}@test.invalid`, role: 'human' });
  const response = await (await import('@/app/api/routes/[id]/mandate/route')).POST(new NextRequest(`https://clawdmkt.test/api/routes/${route}/mandate`, { method: 'POST', headers: { Authorization: `Bearer ${ownerKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, client_reference: `mandate-${randomUUID()}`, max_aggregate: '2.00', max_per_execution: '2.00', max_retry_budget: '0.00', max_attempts: 1, approved_providers: [f.seller], max_latency_seconds: 60, private_data: 'selected_provider_only', expires_at: new Date(Date.now() + 600000).toISOString(), payment: { rail: 'evm', chain_id: 8453, token_address: token, payer_address: privateKeyToAccount(`0x${'11'.repeat(32)}`).address.toLowerCase(), treasury_address: treasury, minimum_token_reserve_units: '5000000', minimum_native_reserve_wei: '1000000', max_gas_cost_wei: '1000000000000' }, ...overrides }) }), { params: Promise.resolve({ id: route }) });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  return (await response.json()).mandate;
}
test('authenticated discovery separates read scopes and writes; cookie/account credentials do not authorize A2A', async () => {
  const reader = await fixture(['agent:read']), writer = await fixture();
  const readCard = await rpc(reader.key, 'GetExtendedAgentCard', {}), writeCard = await rpc(writer.key, 'GetExtendedAgentCard', {});
  assert.equal(readCard.body.result.skills.length, 3);
  assert.equal(writeCard.body.result.skills.length, 5);
  assert.equal(writeCard.response.headers.get('cache-control'), 'private, no-store');
  assert.equal(writeCard.body.result.routing.wallets_broadcast, false);
  const denied = await rpc(reader.key, 'SendMessage', { message: message({ action: 'route_work', request: reader.request }) });
  assert.equal(denied.response.status, 403);
  const account = await rpc(jwt({ userId: writer.owner, email: 'owner@test.invalid', role: 'human' }), 'GetExtendedAgentCard', {});
  assert.equal(account.response.status, 401);
  assert.equal((await db.select().from(schema.a2a_route_tasks)).length, 0);
});
test('fresh objectives persist intent and one plan before owner authority; simultaneous replay preserves task identity', async () => {
  const f = await fixture(), { input, task, route } = await start(f);
  assert.equal(task.status.state, 'TASK_STATE_INPUT_REQUIRED');
  assert.equal(task.artifacts[0].parts[0].data.next_action, 'owner_authorize_then_continue');
  const replay = await Promise.all([rpc(f.key, 'SendMessage', { message: input }), rpc(f.key, 'SendMessage', { message: input })]);
  replay.forEach(r => assert.equal(r.body.result.task.id, task.id));
  assert.equal((await db.select().from(schema.route_plans).where(eq(schema.route_plans.buyer_id, f.buyer))).length, 1);
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer))).length, 0);
  assert.equal((await db.select().from(schema.a2a_route_tasks).where(eq(schema.a2a_route_tasks.id, task.id)))[0].route_id, route);
  const get = await rpc(f.key, 'GetTask', { id: task.id, historyLength: 0 });
  assert.equal(get.body.result.history, undefined);
});
test('an owner mandate and simultaneous continuation reserve exactly one unpaid canonical checkout', async () => {
  const f = await fixture(), s = await start(f), m = await mandate(f, s.route);
  const input = message({ action: 'route_work', route_id: s.route, mandate_id: m.id }, { taskId: s.task.id, contextId: s.task.contextId });
  const results = await Promise.all([rpc(f.key, 'SendMessage', { message: input }), rpc(f.key, 'SendMessage', { message: input })]);
  results.forEach(r => { assert.equal(r.response.status, 200, JSON.stringify(r.body)); assert.equal(r.body.result.task.id, s.task.id); assert.equal(r.body.result.task.status.state, 'TASK_STATE_INPUT_REQUIRED'); });
  const trades = await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer));
  assert.equal(trades.length, 1);
  assert.equal(trades[0].status, 'pending');
  assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.service)))[0].active_orders, 1);
  const cancelled = await rpc(f.key, 'CancelTask', { id: s.task.id });
  assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.result.status.state, 'TASK_STATE_INPUT_REQUIRED');
  assert.equal(cancelled.body.result.artifacts[0].parts[0].data.funds_state, 'payment_unknown');
});
test('message identity cannot be reused across skills or with altered authority; foreign task and route stay private', async () => {
  const f = await fixture(), other = await fixture(), s = await start(f);
  const conflict = await rpc(f.key, 'SendMessage', { message: { ...s.input, parts: [{ text: 'briefing' }] } });
  assert.equal(conflict.response.status, 409);
  assert.equal((await rpc(other.key, 'GetTask', { id: s.task.id })).response.status, 404);
  assert.equal((await rpc(other.key, 'CancelTask', { id: s.task.id })).response.status, 404);
  assert.equal((await rpc(other.key, 'SendMessage', { message: message({ action: 'cancel_route', route_id: s.route }) })).response.status, 404);
  const mismatched = await rpc(f.key, 'SendMessage', { message: message({ action: 'cancel_route', route_id: s.route }, { taskId: s.task.id, contextId: 'foreign-context' }) });
  assert.equal(mismatched.response.status, 409);
  const invalid = await rpc(f.key, 'SendMessage', { message: message({ action: 'route_work', request: { ...f.request, client_reference: 'replace-intent' } }) });
  assert.equal(invalid.response.status, 400);
});
test('mandate expiry, revocation and tightened buyer policy stop A2A reservation without funds', async () => {
  for (const scenario of ['expired', 'revoked', 'policy']) {
    const f = await fixture(), s = await start(f), m = await mandate(f, s.route);
    if (scenario === 'expired')
      await db.update(schema.route_payment_mandates).set({ expires_at: new Date(Date.now() - 1000) }).where(eq(schema.route_payment_mandates.id, m.id));
    if (scenario === 'revoked')
      await db.update(schema.route_payment_mandates).set({ state: 'revoked' }).where(eq(schema.route_payment_mandates.id, m.id));
    if (scenario === 'policy')
      await db.insert(schema.buyer_spend_policies).values({ buyer_id: f.buyer, owner_account_id: f.owner, policy_json: JSON.stringify({ max_per_execution: 1 }) });
    const result = await rpc(f.key, 'SendMessage', { message: message({ action: 'route_work', route_id: s.route, mandate_id: m.id }, { taskId: s.task.id }) });
    assert.ok(result.response.status >= 400, JSON.stringify(result.body));
    assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer))).length, 0);
  }
});
test('planned cancellation is idempotent; production write closure preserves reads and cancellation', async () => {
  const f = await fixture(), s = await start(f), previous = process.env.NODE_ENV;
  try {
    Object.assign(process.env, { NODE_ENV: 'production', CLAWDMARKET_A2A_ROUTING_WRITES_ENABLED: 'false' });
    assert.equal((await rpc(f.key, 'SendMessage', { message: message({ action: 'route_work', request: f.request }) })).response.status, 503);
    assert.equal((await rpc(f.key, 'GetTask', { id: s.task.id })).response.status, 200);
    assert.equal((await rpc(f.key, 'SendMessage', { message: s.input })).body.result.task.id, s.task.id);
    const cancelled = await rpc(f.key, 'CancelTask', { id: s.task.id });
    assert.equal(cancelled.body.result.status.state, 'TASK_STATE_CANCELED');
    assert.equal(cancelled.body.result.artifacts[0].parts[0].data.next_action, 'none');
    assert.equal((await rpc(f.key, 'CancelTask', { id: s.task.id })).body.result.status.state, 'TASK_STATE_CANCELED');
    assert.equal((await rpc(f.key, 'SendMessage', { message: message({ action: 'cancel_route', route_id: s.route }) })).body.result.task.status.state, 'TASK_STATE_CANCELED');
  }
  finally {
    Object.assign(process.env, { NODE_ENV: previous });
    delete process.env.CLAWDMARKET_A2A_ROUTING_WRITES_ENABLED;
  }
});
test('live list filtering and cursor merge include canonical status changes and retained read tasks', async () => {
  const f = await fixture(), s = await start(f);
  const briefing = await rpc(f.key, 'SendMessage', { message: { role: 'ROLE_USER', messageId: randomUUID(), parts: [{ text: 'briefing' }] } });
  assert.equal(briefing.response.status, 200);
  const first = await rpc(f.key, 'ListTasks', { pageSize: 1 }), second = await rpc(f.key, 'ListTasks', { pageSize: 1, pageToken: first.body.result.nextPageToken });
  assert.equal(first.body.result.totalSize, 2);
  assert.equal(second.body.result.nextPageToken, '');
  assert.equal(new Set([first.body.result.tasks[0].id, second.body.result.tasks[0].id]).size, 2);
  const future = new Date(Date.now() + 5000);
  await db.update(schema.route_plans).set({ state: 'cancelled', updated_at: future }).where(eq(schema.route_plans.id, s.route));
  const listed = await rpc(f.key, 'ListTasks', { status: 'TASK_STATE_CANCELED', statusTimestampAfter: new Date(Date.now() + 1000).toISOString(), includeArtifacts: true });
  assert.equal(listed.body.result.totalSize, 1);
  assert.equal(listed.body.result.tasks[0].id, s.task.id);
  assert.equal((await rpc(f.key, 'GetTask', { id: s.task.id })).body.result.status.state, 'TASK_STATE_CANCELED');
});
test('incomplete persisted intent recovers its original plan after a simulated worker crash', async () => {
  const f = await fixture(), s = await start(f);
  await db.update(schema.a2a_route_tasks).set({ route_id: null }).where(eq(schema.a2a_route_tasks.id, s.task.id));
  const script = `const { NextRequest } = await import('next/server.js');
    const { POST } = await import('./app/api/a2a/route.ts');
    const response = await POST(new NextRequest('https://clawdmkt.test/api/a2a', {method:'POST', headers:{Authorization: 'Bearer ' + process.env.A2A_FIXTURE_KEY,'Content-Type':'application/json'},body:process.env.A2A_FIXTURE_REQUEST}));
    process.stdout.write(JSON.stringify({status:response.status,body:await response.json()}));`;
  const child = await promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e', script], { env: { ...process.env, A2A_FIXTURE_KEY: f.key, A2A_FIXTURE_REQUEST: JSON.stringify({jsonrpc:'2.0',id:1,method:'SendMessage',params:{message:s.input}}) } });
  const resumed = JSON.parse(child.stdout);
  assert.equal(resumed.status, 200, child.stdout);
  assert.equal(resumed.body.result.task.id, s.task.id);
  assert.equal(resumed.body.result.task.artifacts[0].parts[0].data.route_id, s.route);
  assert.equal((await db.select().from(schema.route_plans).where(eq(schema.route_plans.buyer_id, f.buyer))).length, 1);
});
test('A2A rejects oversized streamed input and caps retained route history before creating another route', async () => {
  const f = await fixture();
  const oversized = await rpc(f.key, 'SendMessage', { message: message({ action: 'route_work', request: { ...f.request, input: { text: 'x'.repeat(17000) } } }) });
  assert.equal(oversized.response.status, 413);
  const s = await start(f);
  await db.run(sql `UPDATE a2a_route_tasks SET created_at = 1 WHERE id = ${s.task.id}`);
  // Financial task links remain retrievable past the read-only seven-day retention.
  assert.equal((await rpc(f.key, 'GetTask', { id: s.task.id })).response.status, 200);
  await db.insert(schema.a2a_route_tasks).values(Array.from({ length: 99 }, (_, i) => ({ id: randomUUID(), agent_id: f.agent, context_id: 'cap', first_message_id: `cap-${i}`, initial_message: JSON.stringify(message({ action: 'cancel_route', route_id: s.route })), action: 'cancel_route' as const, route_id: s.route, created_at: 1, updated_at: 1 })));
  const limit = await rpc(f.key, 'SendMessage', { message: message({ action: 'route_work', request: f.request }) });
  assert.equal(limit.response.status, 429);
  const replay = await rpc(f.key, 'SendMessage', { message: s.input });
  assert.equal(replay.body.result.task.id, s.task.id);
  assert.equal((await db.select().from(schema.route_plans).where(eq(schema.route_plans.buyer_id, f.buyer))).length, 1);
});


test('each write scope is enforced and rejected first authority exposes its durable recovery task', async () => {
  for (const scopes of [['agent:read', 'marketplace:write'], ['agent:read', 'payments:write']] as const) {
    const f = await fixture([...scopes]);
    assert.equal((await rpc(f.key, 'GetExtendedAgentCard', {})).body.result.skills.length, 3);
    assert.equal((await rpc(f.key, 'SendMessage', { message: message({ action: 'route_work', request: f.request }) })).response.status, 403);
  }
  const f = await fixture(), s = await start(f), m = await mandate(f, s.route);
  await db.update(schema.route_payment_mandates).set({ state: 'revoked' }).where(eq(schema.route_payment_mandates.id, m.id));
  const rejected = await rpc(f.key, 'SendMessage', { message: message({ action: 'route_work', route_id: s.route, mandate_id: m.id }) });
  assert.equal(rejected.response.status, 409);
  const info = rejected.body.error.data[0]; assert.ok(info.metadata.task_id); assert.equal(info.metadata.funds_state, 'no_funds_moved');
  const recovered = await rpc(f.key, 'GetTask', { id: info.metadata.task_id }); assert.equal(recovered.response.status, 200);
  assert.equal(recovered.body.result.artifacts[0].parts[0].data.last_error_code, 'MANDATE_INACTIVE');
});
