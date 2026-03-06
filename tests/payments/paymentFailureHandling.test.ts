import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentError, resolveFailureState } from '@/lib/payment-failure';

test('paymentError returns structured agent-facing error payload', () => {
  const err = paymentError('INSUFFICIENT_FUNDS', 'Not enough balance', { retry_after: 30 });
  assert.deepEqual(err, {
    success: false,
    error_code: 'INSUFFICIENT_FUNDS',
    message: 'Not enough balance',
    retry_after: 30,
  });
});

test('resolveFailureState classifies post-failure fund state deterministically', () => {
  assert.equal(resolveFailureState({ refunded: true, fundsMoved: true }), 'refunded');
  assert.equal(resolveFailureState({ fundsMoved: true }), 'escrow_held');
  assert.equal(resolveFailureState({ disputed: true, fundsMoved: false }), 'escrow_held');
  assert.equal(resolveFailureState({ fundsMoved: false }), 'no_funds_moved');
});
