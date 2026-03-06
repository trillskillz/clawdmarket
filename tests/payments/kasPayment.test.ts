import test from 'node:test';
import assert from 'node:assert/strict';
import { KasPaymentHandler } from '@/src/payments/kasPaymentHandler';

test('creates kas payment with 30 minute expiry', async () => {
  const h = new KasPaymentHandler({
    createDepositAddress: async (id) => `kaspa:${id}`,
    triggerConversion: async () => ({ conversionId: 'c1' }),
    settleOnBase: async () => ({ txHash: '0xabc', convertedAmount: '10' }),
    now: () => new Date('2026-01-01T00:00:00Z'),
  });

  const p = await h.createPayment({ service_id: 'svc1', buyer_agent_address: '0x1', amount_kas: '50' });
  assert.equal(p.status, 'awaiting_kas');
  assert.equal(p.kas_deposit_address, `kaspa:${p.payment_id}`);
  assert.equal(p.expires_at, '2026-01-01T00:30:00.000Z');
});

test('flags partial payment as manual_review', async () => {
  const h = new KasPaymentHandler({
    createDepositAddress: async () => 'kaspa:qq',
    triggerConversion: async () => ({ conversionId: 'c1' }),
    settleOnBase: async () => ({ txHash: '0xabc', convertedAmount: '10' }),
  });

  const p = await h.createPayment({ service_id: 'svc1', buyer_agent_address: '0x1', amount_kas: '50' });
  const updated = await h.onKasDetected({ payment_id: p.payment_id, amount_kas_received: '10', confirmations: 3 });
  assert.equal(updated.status, 'manual_review');
});

test('settles confirmed kas payment with conversion', async () => {
  const h = new KasPaymentHandler({
    createDepositAddress: async () => 'kaspa:qq',
    triggerConversion: async () => ({ conversionId: 'c1' }),
    settleOnBase: async () => ({ txHash: '0xbase', convertedAmount: '49.5' }),
  });

  const p = await h.createPayment({ service_id: 'svc1', buyer_agent_address: '0x1', amount_kas: '50' });
  const updated = await h.onKasDetected({ payment_id: p.payment_id, amount_kas_received: '50', confirmations: 2 });
  assert.equal(updated.status, 'settled');
  assert.equal(updated.settlement_tx_hash, '0xbase');
});
