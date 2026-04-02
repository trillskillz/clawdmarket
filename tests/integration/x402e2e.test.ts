import test from 'node:test';
import assert from 'node:assert/strict';
import { createX402Handler } from '@/src/payments/x402Handler';

function encodePaymentHeader(payload: unknown) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function makeValidPayload(overrides?: Record<string, unknown>) {
  return {
    x402Version: 2,
    resource: { url: 'https://clawdmkt.com/api/service/alpha' },
    accepted: {
      scheme: 'exact',
      network: 'eip155:8453',
      amount: '1000000000000000000',
      asset: '0xBNKR000000000000000000000000000000000000',
      payTo: '0xmerchant0000000000000000000000000000000000',
      maxTimeoutSeconds: 60,
    },
    payload: {
      signature: '0xsignature',
      authorization: {
        from: '0xpayer000000000000000000000000000000000000',
        to: '0xmerchant0000000000000000000000000000000000',
        value: '1000000000000000000',
        validAfter: '1',
        validBefore: '9999999999',
        nonce: '0xnonce-1',
      },
    },
    ...(overrides ?? {}),
  };
}

type DeliveredService = { delivered: boolean; reason?: string };

function createE2EFixture(config?: {
  verifyBehavior?: 'valid' | 'invalid_funds' | 'timeout_throw' | 'double_spend';
  settleBehavior?: 'success' | 'timeout_throw';
  nonceStore?: Set<string>;
}) {
  const nonceStore = config?.nonceStore ?? new Set<string>();
  const serviceState: DeliveredService = { delivered: false };
  let verifyCalls = 0;
  let settleCalls = 0;

  const handler = createX402Handler({
    verifyPayment: async ({ paymentPayload }) => {
      verifyCalls += 1;
      const nonce = paymentPayload.payload.authorization.nonce;

      if (config?.verifyBehavior === 'timeout_throw') {
        throw new Error('verify_timeout');
      }

      if (config?.verifyBehavior === 'invalid_funds') {
        return { isValid: false, invalidReason: 'insufficient_funds', payer: paymentPayload.payload.authorization.from };
      }

      if (config?.verifyBehavior === 'double_spend') {
        if (nonceStore.has(nonce)) {
          return { isValid: false, invalidReason: 'nonce_already_used', payer: paymentPayload.payload.authorization.from };
        }
      }

      return { isValid: true, payer: paymentPayload.payload.authorization.from };
    },
    settlePayment: async ({ paymentPayload }) => {
      settleCalls += 1;

      if (config?.settleBehavior === 'timeout_throw') {
        throw new Error('settle_timeout');
      }

      nonceStore.add(paymentPayload.payload.authorization.nonce);

      return {
        success: true,
        payer: paymentPayload.payload.authorization.from,
        transaction: `0xtx_${settleCalls}`,
        network: paymentPayload.accepted.network,
      };
    },
    sleep: async () => undefined,
    generateRequestId: () => 'req_e2e_1',
  });

  async function processAgentTransaction(headerPayload: unknown) {
    const paymentResult = await handler.handle({
      headers: {
        'PAYMENT-SIGNATURE': encodePaymentHeader(headerPayload),
      },
      method: 'POST',
      path: '/api/agent/service/execute',
      isAgentToAgentRequest: true,
    });

    if (paymentResult && paymentResult.success) {
      serviceState.delivered = true;
      return { paymentResult, serviceState };
    }

    serviceState.delivered = false;
    serviceState.reason = paymentResult && !paymentResult.success ? paymentResult.message : 'unknown_payment_failure';
    return { paymentResult, serviceState };
  }

  return { processAgentTransaction, serviceState, counts: () => ({ verifyCalls, settleCalls }) };
}

test('x402 e2e happy path: payment verifies, settles, and service is delivered', async () => {
  const fx = createE2EFixture();
  const { paymentResult, serviceState } = await fx.processAgentTransaction(makeValidPayload());

  assert.ok(paymentResult && paymentResult.success, 'payment should succeed');
  if (!paymentResult || !paymentResult.success) return;

  assert.equal(paymentResult.settlement.transaction.startsWith('0xtx_'), true);
  assert.equal(serviceState.delivered, true);
  const counts = fx.counts();
  assert.equal(counts.verifyCalls, 1);
  assert.equal(counts.settleCalls, 1);
});

test('x402 e2e insufficient funds: payment fails gracefully and service is not delivered', async () => {
  const fx = createE2EFixture({ verifyBehavior: 'invalid_funds' });
  const { paymentResult, serviceState } = await fx.processAgentTransaction(makeValidPayload());

  assert.ok(paymentResult && !paymentResult.success, 'payment should fail');
  if (!paymentResult || paymentResult.success) return;

  assert.equal(paymentResult.error_code, 'VERIFICATION_FAILED');
  assert.match(paymentResult.message, /insufficient_funds/i);
  assert.equal(serviceState.delivered, false);
  const counts = fx.counts();
  assert.equal(counts.verifyCalls, 1);
  assert.equal(counts.settleCalls, 0);
});

test('x402 e2e timeout: verification timeout triggers retry then clean failure', async () => {
  const fx = createE2EFixture({ verifyBehavior: 'timeout_throw' });
  const { paymentResult, serviceState } = await fx.processAgentTransaction(makeValidPayload());

  assert.ok(paymentResult && !paymentResult.success, 'payment should fail after retries');
  if (!paymentResult || paymentResult.success) return;

  assert.equal(paymentResult.error_code, 'RETRY_EXHAUSTED');
  assert.equal(paymentResult.retry_after, 1);
  assert.equal(serviceState.delivered, false);
  const counts = fx.counts();
  assert.equal(counts.verifyCalls, 4, 'initial + max 3 retries');
  assert.equal(counts.settleCalls, 0);
});

test('x402 e2e malformed header: rejects immediately with clear error code', async () => {
  const fx = createE2EFixture();
  const handler = createX402Handler({
    verifyPayment: async () => ({ isValid: true }),
    settlePayment: async () => ({ success: true, transaction: '0x', network: 'eip155:8453' }),
    sleep: async () => undefined,
  });

  const paymentResult = await handler.handle({
    headers: { 'PAYMENT-SIGNATURE': Buffer.from('{bad json', 'utf8').toString('base64') },
    method: 'POST',
    path: '/api/agent/service/execute',
    isAgentToAgentRequest: true,
  });

  assert.ok(paymentResult && !paymentResult.success);
  if (!paymentResult || paymentResult.success) return;

  assert.equal(paymentResult.error_code, 'MALFORMED_PAYMENT_SIGNATURE');
  assert.match(paymentResult.message, /valid JSON/i);
  assert.equal(fx.serviceState.delivered, false);
});

test('x402 e2e double-spend attempt: second use of same payment proof is rejected', async () => {
  const sharedNonceStore = new Set<string>();
  const fx = createE2EFixture({ verifyBehavior: 'double_spend', nonceStore: sharedNonceStore });

  const payload = makeValidPayload({
    payload: {
      signature: '0xsig-reused',
      authorization: {
        from: '0xpayer000000000000000000000000000000000000',
        to: '0xmerchant0000000000000000000000000000000000',
        value: '1000000000000000000',
        validAfter: '1',
        validBefore: '9999999999',
        nonce: '0xreused-nonce',
      },
    },
  });

  const first = await fx.processAgentTransaction(payload);
  assert.ok(first.paymentResult && first.paymentResult.success, 'first payment should succeed');

  const second = await fx.processAgentTransaction(payload);
  assert.ok(second.paymentResult && !second.paymentResult.success, 'second payment should fail');
  if (!second.paymentResult || second.paymentResult.success) return;

  assert.equal(second.paymentResult.error_code, 'VERIFICATION_FAILED');
  assert.match(second.paymentResult.message, /nonce_already_used/i);
  assert.equal(second.serviceState.delivered, false);
});
