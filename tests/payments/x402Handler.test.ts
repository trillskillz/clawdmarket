import test from 'node:test';
import assert from 'node:assert/strict';
import { createX402Handler } from '@/src/payments/x402Handler';

function toHeader(payload: unknown) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

const validPayload = {
  x402Version: 2,
  accepted: {
    scheme: 'exact',
    network: 'eip155:8453',
    amount: '1000',
    asset: '0xasset',
    payTo: '0xmerchant',
  },
  payload: {
    signature: '0xsig',
    authorization: {
      from: '0xpayer',
      to: '0xmerchant',
      value: '1000',
      validAfter: '1',
      validBefore: '9999999999',
      nonce: '0xnonce',
    },
  },
};

test('returns null for non-agent requests', async () => {
  const handler = createX402Handler({
    verifyPayment: async () => ({ isValid: true }),
    settlePayment: async () => ({ success: true, transaction: '0xtx', network: 'eip155:8453' }),
  });

  const result = await handler.handle({
    headers: {},
    method: 'POST',
    path: '/api/trades',
    isAgentToAgentRequest: false,
  });

  assert.equal(result, null);
});

test('fails on missing PAYMENT-SIGNATURE header', async () => {
  const handler = createX402Handler({
    verifyPayment: async () => ({ isValid: true }),
    settlePayment: async () => ({ success: true, transaction: '0xtx', network: 'eip155:8453' }),
  });

  const result = await handler.handle({
    headers: {},
    method: 'POST',
    path: '/api/trades',
    isAgentToAgentRequest: true,
  });

  assert.ok(result && result.success === false);
  if (!result || result.success) throw new Error('Expected error response');
  assert.equal(result.error_code, 'MISSING_PAYMENT_SIGNATURE');
});

test('fails on malformed base64 payload', async () => {
  const handler = createX402Handler({
    verifyPayment: async () => ({ isValid: true }),
    settlePayment: async () => ({ success: true, transaction: '0xtx', network: 'eip155:8453' }),
  });

  const result = await handler.handle({
    headers: { 'PAYMENT-SIGNATURE': 'not-base64-json' },
    method: 'POST',
    path: '/api/trades',
    isAgentToAgentRequest: true,
  });

  assert.ok(result && result.success === false);
  if (!result || result.success) throw new Error('Expected error response');
  assert.equal(result.error_code, 'MALFORMED_PAYMENT_SIGNATURE');
});

test('returns success on valid verify + settle', async () => {
  const handler = createX402Handler({
    verifyPayment: async () => ({ isValid: true, payer: '0xpayer' }),
    settlePayment: async () => ({ success: true, transaction: '0xtx', network: 'eip155:8453', payer: '0xpayer' }),
    sleep: async () => undefined,
  });

  const result = await handler.handle({
    headers: { 'PAYMENT-SIGNATURE': toHeader(validPayload) },
    method: 'POST',
    path: '/api/trades',
    isAgentToAgentRequest: true,
  });

  assert.ok(result && result.success === true);
  if (!result || !result.success) throw new Error('Expected success response');
  assert.equal(result.settlement.transaction, '0xtx');
});

test('retries settle up to recovery', async () => {
  let settleCalls = 0;
  const handler = createX402Handler({
    verifyPayment: async () => ({ isValid: true, payer: '0xpayer' }),
    settlePayment: async () => {
      settleCalls += 1;
      if (settleCalls < 3) throw new Error('temporary upstream issue');
      return { success: true, transaction: '0xafter-retry', network: 'eip155:8453' };
    },
    sleep: async () => undefined,
  });

  const result = await handler.handle({
    headers: { 'PAYMENT-SIGNATURE': toHeader(validPayload) },
    method: 'POST',
    path: '/api/trades',
    isAgentToAgentRequest: true,
  });

  assert.ok(result && result.success === true);
  assert.equal(settleCalls, 3);
});

test('returns retry exhausted when verify keeps throwing', async () => {
  let verifyCalls = 0;
  const handler = createX402Handler({
    verifyPayment: async () => {
      verifyCalls += 1;
      throw new Error('network down');
    },
    settlePayment: async () => ({ success: true, transaction: '0xtx', network: 'eip155:8453' }),
    sleep: async () => undefined,
  });

  const result = await handler.handle({
    headers: { 'PAYMENT-SIGNATURE': toHeader(validPayload) },
    method: 'POST',
    path: '/api/trades',
    isAgentToAgentRequest: true,
  });

  assert.ok(result && result.success === false);
  if (!result || result.success) throw new Error('Expected error response');
  assert.equal(result.error_code, 'RETRY_EXHAUSTED');
  assert.equal(verifyCalls, 4); // initial + max 3 retries
});
