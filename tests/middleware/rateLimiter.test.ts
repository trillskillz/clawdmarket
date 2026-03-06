import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, InMemorySharedRateLimitStore } from '@/src/middleware/rateLimiter';

function buildLimiter() {
  let nowValue = 1_700_000_000_000;
  return {
    tick: (ms = 0) => {
      nowValue += ms;
      return nowValue;
    },
    limiter: createRateLimiter({
      store: new InMemorySharedRateLimitStore(),
      allowlistAgentIds: ['agent_internal'],
      now: () => nowValue,
    }),
  };
}

test('listing creation enforces max 10/hour with 429 + Retry-After + structured body', async () => {
  const { limiter } = buildLimiter();

  for (let i = 0; i < 10; i++) {
    const ok = await limiter.enforce({
      policy: 'listing_creation',
      agentId: 'agent_1',
      method: 'POST',
      path: '/api/listings',
    });
    assert.equal(ok.allowed, true);
  }

  const blocked = await limiter.enforce({
    policy: 'listing_creation',
    agentId: 'agent_1',
    method: 'POST',
    path: '/api/listings',
  });

  assert.equal(blocked.allowed, false);
  if (blocked.allowed) return;
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers['Retry-After']) >= 1);
  assert.equal(blocked.body.success, false);
  assert.equal(blocked.body.error_code, 'RATE_LIMIT_EXCEEDED');
});

test('transaction initiation enforces 60/min', async () => {
  const { limiter } = buildLimiter();

  for (let i = 0; i < 60; i++) {
    const ok = await limiter.enforce({
      policy: 'transaction_initiation',
      agentId: 'agent_2',
      method: 'POST',
      path: '/api/trades',
    });
    assert.equal(ok.allowed, true);
  }

  const blocked = await limiter.enforce({
    policy: 'transaction_initiation',
    agentId: 'agent_2',
    method: 'POST',
    path: '/api/trades',
  });

  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) {
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers['X-RateLimit-Policy'], 'transaction_initiation');
  }
});

test('search/query enforces 120/min and resets after window', async () => {
  const { limiter, tick } = buildLimiter();

  for (let i = 0; i < 120; i++) {
    const ok = await limiter.enforce({
      policy: 'search_query',
      agentId: 'agent_3',
      method: 'GET',
      path: '/api/listings?search=agent',
    });
    assert.equal(ok.allowed, true);
  }

  const blocked = await limiter.enforce({
    policy: 'search_query',
    agentId: 'agent_3',
    method: 'GET',
    path: '/api/listings?search=agent',
  });
  assert.equal(blocked.allowed, false);

  tick(61_000);

  const resetOk = await limiter.enforce({
    policy: 'search_query',
    agentId: 'agent_3',
    method: 'GET',
    path: '/api/listings?search=agent',
  });
  assert.equal(resetOk.allowed, true);
});

test('allowlisted agent is exempted', async () => {
  const { limiter } = buildLimiter();

  for (let i = 0; i < 200; i++) {
    const decision = await limiter.enforce({
      policy: 'transaction_initiation',
      agentId: 'agent_internal',
      method: 'POST',
      path: '/api/trades',
    });
    assert.equal(decision.allowed, true);
    if (decision.allowed) {
      assert.equal(decision.headers['X-RateLimit-Bypass'], 'allowlist');
    }
  }
});
