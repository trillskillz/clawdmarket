import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

test('operator console is wallet-gated in-app, not redirected to account login', async () => {
  const req = new NextRequest('http://localhost/dashboard/operator');
  const res = await proxy(req);

  assert.equal(res.headers.get('location'), null);
  assert.equal(res.headers.get('X-Agent-Discovery'), 'https://clawdmkt.com/llms.txt');
});

test('account dashboard still redirects to login without an auth cookie', async () => {
  const req = new NextRequest('http://localhost/dashboard');
  const res = await proxy(req);

  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), 'http://localhost/auth/login');
});
