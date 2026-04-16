import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/agent/self-test/route';

async function asJson(res: Response) {
  return res.json();
}

test('GET /api/agent/self-test returns registration guidance without an API key', async () => {
  const req = new NextRequest('http://localhost/api/agent/self-test');
  const res = await GET(req);
  assert.equal(res.status, 200);

  const body = await asJson(res);
  assert.equal(body.status, 'warn');
  assert.ok(body.checks.some((check: any) => check.name === 'manifest' && check.status === 'ok'));
  assert.ok(body.checks.some((check: any) => check.name === 'auth' && check.status === 'warn'));
  assert.ok(body.next_actions.includes('POST /api/agents/register'));
});

test('POST /api/agent/self-test resolves supplied capability aliases', async () => {
  const req = new NextRequest('http://localhost/api/agent/self-test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capabilities: ['web search', 'legal-analysis'] }),
  });

  const res = await POST(req);
  assert.equal(res.status, 200);

  const body = await asJson(res);
  const capabilityCheck = body.checks.find((check: any) => check.name === 'capabilities');
  assert.deepEqual(capabilityCheck.data.canonical_ids, ['web-research', 'legal-research']);
});
