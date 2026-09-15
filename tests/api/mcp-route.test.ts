import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET, OPTIONS, POST } from '@/app/api/mcp/route';
import { AGENT_MCP_TOOLS } from '@/lib/agent-contract';
import { mcpPaymentRequiredResponse } from '@/lib/mcp-payment-response';

async function asJson(res: Response) {
  return res.json();
}

test('GET /api/mcp returns server info + capabilities + CORS headers', async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  assert.equal(res.headers.get('Access-Control-Allow-Headers'), 'Content-Type, Authorization, X-Agent-API-Key, X-ClawdMarket-Agent-Key, X-CSRF-Token');

  const body = await asJson(res);
  assert.equal(body.server?.name, 'clawdmarket-mcp');
  assert.ok(body.capabilities);
});

test('OPTIONS preflight returns 200 + CORS headers', async () => {
  const res = await OPTIONS();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
});

test('MCP payment challenge is available in JSON-RPC and WWW-Authenticate', async () => {
  const challenge = {
    expires: '2026-09-15T01:00:00.000Z',
    id: 'challenge-id',
    intent: 'charge',
    method: 'tempo',
    realm: 'clawdmkt.com',
    request: {
      amount: '1000',
      currency: '0x20c0000000000000000000000000000000000000',
      methodDetails: { chainId: 4217 },
      recipient: '0x3E911a2EaFbE60ca538F659836d6DE60Db639D44',
    },
  };
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32042, message: 'Payment is required.', data: { httpStatus: 402, challenges: [challenge] } },
  };
  const response = mcpPaymentRequiredResponse(payload);
  const body = await response.json();

  assert.equal(response.status, 402);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('www-authenticate') || '', /^Payment /);
  assert.equal(body.error.data.challenges[0].realm, 'clawdmkt.com');
});

test('initialize JSON-RPC returns serverInfo + capabilities', async () => {
  const req = new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }),
  });

  const res = await POST(req);
  assert.equal(res.status, 200);
  const body = await asJson(res);
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.id, 1);
  assert.equal(body.result?.serverInfo?.name, 'clawdmarket-mcp');
  assert.ok(body.result?.capabilities);
});

test('tools/list returns required tool manifest names', async () => {
  const req = new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  });

  const res = await POST(req);
  assert.equal(res.status, 200);
  const body = await asJson(res);
  const names = (body.result?.tools || []).map((t: any) => t.name);
  assert.deepEqual(names, AGENT_MCP_TOOLS.map((tool) => tool.name));
});

test('tools/call fails closed when MPP verification is unavailable', async () => {
  const req = new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'does_not_exist', arguments: {} },
    }),
  });

  const res = await POST(req);
  assert.equal(res.status, 503);
  const body = await asJson(res);
  assert.equal(body.error, 'payment_service_unavailable');
});

test('tools/call list_agents executes with mocked MPP payment receipt', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalPaymentBypass = process.env.CLAWDMARKET_MCP_TEST_PAYMENT;

  process.env.CLAWDMARKET_MCP_TEST_PAYMENT = 'true';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/agents/list');
    assert.equal(url.searchParams.get('limit'), '1');

    return Response.json({
      agents: [{ id: 'agent_test', name: 'Test Agent', capabilities: ['web-research'] }],
      total: 1,
    });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalPaymentBypass === undefined) {
      delete process.env.CLAWDMARKET_MCP_TEST_PAYMENT;
    } else {
      process.env.CLAWDMARKET_MCP_TEST_PAYMENT = originalPaymentBypass;
    }
  });

  const req = new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Payment test_receipt',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'list_agents', arguments: { limit: 1 } },
    }),
  });

  const res = await POST(req);
  assert.equal(res.status, 200);
  const body = await asJson(res);
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.mpp_receipt?.id, 'test_mpp_receipt');

  const toolPayload = JSON.parse(body.result.content[0].text);
  assert.equal(toolPayload.total, 1);
  assert.equal(toolPayload.agents[0].id, 'agent_test');
});

test('tools/call list_agents fails closed when MPP verification is unavailable', async () => {
  const req = new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'list_agents', arguments: { limit: 1 } },
    }),
  });

  const res = await POST(req);
  assert.equal(res.status, 503);
  const body = await asJson(res);
  assert.equal(body.error, 'payment_service_unavailable');
});
