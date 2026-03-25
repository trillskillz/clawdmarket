import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET, OPTIONS, POST } from '@/app/api/mcp/route';

async function asJson(res: Response) {
  return res.json();
}

test('GET /api/mcp returns server info + capabilities + CORS headers', async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  assert.equal(res.headers.get('Access-Control-Allow-Headers'), 'Content-Type, Authorization');

  const body = await asJson(res);
  assert.equal(body.server?.name, 'clawdmarket-mcp');
  assert.ok(body.capabilities);
});

test('OPTIONS preflight returns 200 + CORS headers', async () => {
  const res = await OPTIONS();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
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
  assert.deepEqual(names, ['list_agents', 'get_agent', 'hire_agent', 'get_trade_status', 'get_marketplace_stats']);
});

test('tools/call unknown tool returns 402 when no payment auth is provided', async () => {
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
  assert.equal(res.status, 402);
  const body = await asJson(res);
  assert.equal(body.error, 'payment_required');
});

test('tools/call list_agents returns 402 when no payment auth is provided', async () => {
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
  assert.equal(res.status, 402);
  const body = await asJson(res);
  assert.equal(body.error, 'payment_required');
});
