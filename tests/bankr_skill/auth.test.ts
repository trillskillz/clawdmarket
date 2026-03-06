import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createBankrAuthBridge } from '@/src/bankr_skill/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.JWT_SECRET = JWT_SECRET;

function makeDeps() {
  const created: string[] = [];
  return {
    created,
    deps: {
      findAgentByApiKey: async (apiKey: string) =>
        apiKey === 'clawd_valid_key'
          ? { agent_id: 'agent_api', wallet_address: '0xapi', user_id: 'user_api' }
          : null,
      findAgentByUserId: async (userId: string) =>
        userId === 'user_jwt'
          ? { agent_id: 'agent_jwt', wallet_address: '0xjwt', user_id: 'user_jwt' }
          : null,
      findAgentByWallet: async (walletAddress: string) =>
        walletAddress.toLowerCase() === '0xknownwallet'
          ? { agent_id: 'agent_wallet', wallet_address: '0xknownwallet', user_id: 'user_wallet' }
          : null,
      createAgentForWallet: async (walletAddress: string) => {
        created.push(walletAddress);
        return { agent_id: 'agent_created', wallet_address: walletAddress, user_id: 'user_created' };
      },
      verifyWalletSignature: async ({ signature }: { walletAddress: string; signature: string; payload: string }) =>
        signature === 'valid_sig',
      now: (() => {
        let t = 1_700_000_000_000;
        return () => t++;
      })(),
    },
  };
}

test('auth bridge: API key happy path', async () => {
  const { deps } = makeDeps();
  const bridge = createBankrAuthBridge(deps);

  const res = await bridge.authenticate({
    headers: {
      Authorization: 'Bearer clawd_valid_key',
    },
  });

  assert.equal(res.success, true);
  if (!res.success) return;
  assert.equal(res.auth_method, 'api_key');
  assert.equal(res.agent.agent_id, 'agent_api');
});

test('auth bridge: wallet signature happy path auto-associates missing wallet', async () => {
  const { deps, created } = makeDeps();
  const bridge = createBankrAuthBridge(deps);

  const res = await bridge.authenticate({
    headers: {
      'x-agent-wallet': '0xNewWallet',
      'x-agent-signature': 'valid_sig',
      'x-agent-signed-payload': '{"intent":"check_balance"}',
    },
    body: { intent: 'check_balance' },
  });

  assert.equal(res.success, true);
  if (!res.success) return;
  assert.equal(res.auth_method, 'wallet_signature');
  assert.equal(res.agent.agent_id, 'agent_created');
  assert.deepEqual(created, ['0xNewWallet']);
});

test('auth bridge: rejects invalid API key', async () => {
  const { deps } = makeDeps();
  const bridge = createBankrAuthBridge(deps);

  const res = await bridge.authenticate({
    headers: { Authorization: 'Bearer clawd_bad_key' },
  });

  assert.equal(res.success, false);
  if (res.success) return;
  assert.equal(res.error_code, 'INVALID_API_KEY');
  assert.equal(res.status, 401);
});

test('auth bridge: rejects invalid and expired bearer tokens', async () => {
  const { deps } = makeDeps();
  const bridge = createBankrAuthBridge(deps);

  const invalid = await bridge.authenticate({
    headers: { Authorization: 'Bearer definitely.not.a.jwt' },
  });

  assert.equal(invalid.success, false);
  if (!invalid.success) assert.equal(invalid.error_code, 'INVALID_TOKEN');

  const expired = jwt.sign(
    { userId: 'user_jwt', email: 'a@b.com', role: 'agent' },
    JWT_SECRET,
    { expiresIn: -10 },
  );

  const expiredRes = await bridge.authenticate({
    headers: { Authorization: `Bearer ${expired}` },
  });

  assert.equal(expiredRes.success, false);
  if (!expiredRes.success) assert.equal(expiredRes.error_code, 'INVALID_TOKEN');
});

test('auth bridge: enforces per-agent rate limits (60/min, 1000/hour configurable)', async () => {
  const { deps } = makeDeps();
  const bridge = createBankrAuthBridge(deps, { minWindowLimit: 2, hourWindowLimit: 3 });

  const first = await bridge.authenticate({ headers: { Authorization: 'Bearer clawd_valid_key' } });
  const second = await bridge.authenticate({ headers: { Authorization: 'Bearer clawd_valid_key' } });
  const third = await bridge.authenticate({ headers: { Authorization: 'Bearer clawd_valid_key' } });

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(third.success, false);
  if (!third.success) {
    assert.equal(third.status, 429);
    assert.equal(third.error_code, 'RATE_LIMITED');
    assert.ok((third.retry_after ?? 0) >= 1);
  }
});
