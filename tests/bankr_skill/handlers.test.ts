import test from 'node:test';
import assert from 'node:assert/strict';
import { createBankrSkillHandlers, type IntentEnvelope } from '@/src/bankr_skill/handlers';

function makeIntent(intent: IntentEnvelope['intent'], params: Record<string, unknown>): IntentEnvelope {
  return {
    intent,
    agent_id: 'agent_1',
    wallet: '0xagent',
    timestamp: Date.now(),
    params,
  };
}

test('listService validates required params and creates listing', async () => {
  const calls: string[] = [];
  const handlers = createBankrSkillHandlers({
    createListing: async () => {
      calls.push('createListing');
      return { listing_id: 'lst_1' };
    },
    searchListings: async () => [],
    findListingByName: async () => null,
    settlePayment: async () => ({ success: false, payment_method: 'bnkr' }),
    getAgentBalance: async () => ({ kas_balance: 0, pending_escrow: 0 }),
    logInvocation: (entry) => {
      calls.push(`log:${entry.intent}:${entry.success}`);
    },
  });

  const invalid = await handlers.listService(makeIntent('list_service', {}));
  assert.equal(invalid.success, false);

  const valid = await handlers.listService(
    makeIntent('list_service', {
      service_name: 'Logo Design',
      description: 'I design logos',
      price_kas: 25,
      agent_wallet_address: '0xabc',
    }),
  );

  assert.equal(valid.success, true);
  assert.equal(valid.data?.listing_id, 'lst_1');
  assert.ok(calls.includes('createListing'));
});

test('findAgent returns top matches with required fields', async () => {
  const handlers = createBankrSkillHandlers({
    createListing: async () => ({ listing_id: 'x' }),
    searchListings: async () => [
      { id: 'a', name: 'Audit Bot', price_kas: 50, agent_wallet_address: '0x1' },
      { id: 'b', name: 'Deploy Bot', price_kas: 30, agent_wallet_address: '0x2' },
    ],
    findListingByName: async () => null,
    settlePayment: async () => ({ success: false, payment_method: 'bnkr' }),
    getAgentBalance: async () => ({ kas_balance: 0, pending_escrow: 0 }),
    logInvocation: () => undefined,
  });

  const result = await handlers.findAgent(makeIntent('find_agent', { capability_keyword: 'audit' }));
  assert.equal(result.success, true);
  const matches = result.data?.matches as Array<Record<string, unknown>>;
  assert.equal(matches.length, 2);
  assert.equal(matches[0].name, 'Audit Bot');
  assert.equal(matches[0].agent_wallet_address, '0x1');
});

test('payWithBnkr routes through settlement and returns structured success', async () => {
  let settleCalled = false;
  const handlers = createBankrSkillHandlers({
    createListing: async () => ({ listing_id: 'x' }),
    searchListings: async () => [],
    findListingByName: async () => ({ id: 'l1', seller_id: 'seller_1', price_bnkr: '12.5' }),
    settlePayment: async () => {
      settleCalled = true;
      return {
        success: true,
        payment_method: 'bnkr',
        transaction_id: 'tx_1',
        details: { onchain_transaction: '0xabc' },
      };
    },
    getAgentBalance: async () => ({ kas_balance: 0, pending_escrow: 0 }),
    logInvocation: () => undefined,
  });

  const result = await handlers.payWithBnkr(
    makeIntent('pay_with_bnkr', {
      service_id_or_name: 'Audit Service',
      payer_wallet: '0xagent',
      max_amount_bnkr: '15',
    }),
    {
      x402Headers: { 'PAYMENT-SIGNATURE': 'abc' },
      method: 'POST',
      path: '/api/bankr_skill/intent/pay-with-bnkr',
    },
  );

  assert.equal(settleCalled, true);
  assert.equal(result.success, true);
  assert.equal(result.data?.payment_method, 'bnkr');
});

test('payWithBnkr handles settlement failure gracefully', async () => {
  const handlers = createBankrSkillHandlers({
    createListing: async () => ({ listing_id: 'x' }),
    searchListings: async () => [],
    findListingByName: async () => ({ id: 'l1', seller_id: 'seller_1', price_bnkr: '12.5' }),
    settlePayment: async () => ({
      success: false,
      payment_method: 'bnkr',
      error_code: 'VERIFICATION_FAILED',
      message: 'insufficient_funds',
    }),
    getAgentBalance: async () => ({ kas_balance: 0, pending_escrow: 0 }),
    logInvocation: () => undefined,
  });

  const result = await handlers.payWithBnkr(
    makeIntent('pay_with_bnkr', {
      service_id_or_name: 'Audit Service',
      payer_wallet: '0xagent',
      max_amount_bnkr: '15',
    }),
  );

  assert.equal(result.success, false);
  assert.equal(result.error_code, 'VERIFICATION_FAILED');
});

test('checkBalance returns KAS balance and pending escrow', async () => {
  const handlers = createBankrSkillHandlers({
    createListing: async () => ({ listing_id: 'x' }),
    searchListings: async () => [],
    findListingByName: async () => null,
    settlePayment: async () => ({ success: false, payment_method: 'bnkr' }),
    getAgentBalance: async () => ({ kas_balance: 123.45, pending_escrow: 7.89 }),
    logInvocation: () => undefined,
  });

  const result = await handlers.checkBalance(
    makeIntent('check_balance', {
      agent_wallet_address: '0xwallet123',
    }),
  );

  assert.equal(result.success, true);
  assert.equal(result.data?.kas_balance, 123.45);
  assert.equal(result.data?.pending_escrow, 7.89);
});
