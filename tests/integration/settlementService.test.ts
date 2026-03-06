import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettlementService, resolvePaymentMethod } from '@/src/payments/settlementService';

test('resolvePaymentMethod routes BNKR transaction types correctly', () => {
  assert.equal(resolvePaymentMethod('agent_execution_fee'), 'bnkr');
  assert.equal(resolvePaymentMethod('agent_service_payment'), 'bnkr');
  assert.equal(resolvePaymentMethod('listing_fee'), 'clawdcoin');
  assert.equal(resolvePaymentMethod('service_payment'), 'clawdcoin');
});

test('BNKR flow uses x402 and records payment_method=bnkr', async () => {
  let bnkrCalls = 0;
  let clawdcoinCalls = 0;
  const records: Array<{ payment_method: string; id: string }> = [];

  const service = createSettlementService({
    executeBnkrViaX402: async () => {
      bnkrCalls += 1;
      return {
        success: true,
        verification: { isValid: true, payer: '0xpayer' },
        settlement: {
          success: true,
          payer: '0xpayer',
          transaction: '0xchain',
          network: 'eip155:8453',
        },
        metadata: { requestId: 'req_1', attempts: 2 },
      };
    },
    executeClawdcoinSettlement: async () => {
      clawdcoinCalls += 1;
      return { success: true, payment_method: 'clawdcoin', transaction_id: 'should_not_use' };
    },
    recordTransaction: async (record) => {
      records.push({ payment_method: record.payment_method, id: record.id });
    },
    generateTransactionId: () => 'tx_bnkr_1',
  });

  const result = await service.settle({
    transaction_type: 'agent_execution_fee',
    amount: '10.5',
    payer_id: 'agentA',
    recipient_id: 'agentB',
    x402: {
      headers: { 'PAYMENT-SIGNATURE': 'abc' },
      method: 'POST',
      path: '/api/agents/pay',
      isAgentToAgentRequest: true,
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.payment_method, 'bnkr');
  assert.equal(result.transaction_id, 'tx_bnkr_1');
  assert.equal(bnkrCalls, 1);
  assert.equal(clawdcoinCalls, 0);
  assert.deepEqual(records, [{ payment_method: 'bnkr', id: 'tx_bnkr_1' }]);
});

test('CLAWDCOIN flow uses existing settlement and records payment_method=clawdcoin', async () => {
  let bnkrCalls = 0;
  let clawdcoinCalls = 0;
  const records: Array<{ payment_method: string; id: string }> = [];

  const service = createSettlementService({
    executeBnkrViaX402: async () => {
      bnkrCalls += 1;
      return null;
    },
    executeClawdcoinSettlement: async () => {
      clawdcoinCalls += 1;
      return {
        success: true,
        payment_method: 'clawdcoin',
        transaction_id: 'tx_clawd_1',
        details: { ledger_entry: 'wallet_ledger' },
      };
    },
    recordTransaction: async (record) => {
      records.push({ payment_method: record.payment_method, id: record.id });
    },
  });

  const result = await service.settle({
    transaction_type: 'service_payment',
    amount: '42',
    payer_id: 'buyer1',
    recipient_id: 'seller1',
  });

  assert.equal(result.success, true);
  assert.equal(result.payment_method, 'clawdcoin');
  assert.equal(result.transaction_id, 'tx_clawd_1');
  assert.equal(bnkrCalls, 0);
  assert.equal(clawdcoinCalls, 1);
  assert.deepEqual(records, [{ payment_method: 'clawdcoin', id: 'tx_clawd_1' }]);
});

test('BNKR flow fails cleanly without x402 context and does not call CLAWDCOIN flow', async () => {
  let bnkrCalls = 0;
  let clawdcoinCalls = 0;
  let records = 0;

  const service = createSettlementService({
    executeBnkrViaX402: async () => {
      bnkrCalls += 1;
      return null;
    },
    executeClawdcoinSettlement: async () => {
      clawdcoinCalls += 1;
      return { success: true, payment_method: 'clawdcoin' };
    },
    recordTransaction: async () => {
      records += 1;
    },
  });

  const result = await service.settle({
    transaction_type: 'agent_service_payment',
    amount: '5',
    payer_id: 'agentA',
    recipient_id: 'agentB',
  });

  assert.equal(result.success, false);
  assert.equal(result.payment_method, 'bnkr');
  assert.equal(result.error_code, 'X402_CONTEXT_REQUIRED');
  assert.equal(bnkrCalls, 0);
  assert.equal(clawdcoinCalls, 0);
  assert.equal(records, 0);
});

test('flow independence: BNKR failure does not mutate CLAWDCOIN execution state', async () => {
  const callLog: string[] = [];

  const service = createSettlementService({
    executeBnkrViaX402: async () => {
      callLog.push('bnkr');
      return {
        success: false,
        error_code: 'VERIFICATION_FAILED',
        message: 'insufficient_funds',
      };
    },
    executeClawdcoinSettlement: async () => {
      callLog.push('clawdcoin');
      return {
        success: true,
        payment_method: 'clawdcoin',
        transaction_id: 'tx_clawd_2',
      };
    },
    recordTransaction: async () => {
      callLog.push('record');
    },
  });

  const bnkrResult = await service.settle({
    transaction_type: 'agent_execution_fee',
    amount: '1',
    payer_id: 'agentX',
    recipient_id: 'agentY',
    x402: {
      headers: { 'PAYMENT-SIGNATURE': 'abc' },
      method: 'POST',
      path: '/api/pay',
      isAgentToAgentRequest: true,
    },
  });

  const clawdResult = await service.settle({
    transaction_type: 'listing_fee',
    amount: '1',
    payer_id: 'agentX',
    recipient_id: 'marketplace',
  });

  assert.equal(bnkrResult.success, false);
  assert.equal(clawdResult.success, true);
  assert.deepEqual(callLog, ['bnkr', 'clawdcoin', 'record']);
});
