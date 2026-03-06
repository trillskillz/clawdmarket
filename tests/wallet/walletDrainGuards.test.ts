import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ESCROW_AMOUNT,
  MAX_TRANSFER_AMOUNT,
  WalletGuardError,
  validateEscrowAmount,
  validateTransferAmount,
} from '@/lib/wallet-guards';

test('transfer guard enforces positive and capped amounts', () => {
  assert.throws(() => validateTransferAmount(0), (e: any) => e instanceof WalletGuardError && e.code === 'INVALID_AMOUNT');
  assert.throws(
    () => validateTransferAmount(MAX_TRANSFER_AMOUNT + 1),
    (e: any) => e instanceof WalletGuardError && e.code === 'AMOUNT_EXCEEDS_CAP',
  );
  assert.doesNotThrow(() => validateTransferAmount(1));
});

test('escrow guard enforces positive and capped amounts', () => {
  assert.throws(() => validateEscrowAmount(-1), (e: any) => e instanceof WalletGuardError && e.code === 'INVALID_AMOUNT');
  assert.throws(
    () => validateEscrowAmount(MAX_ESCROW_AMOUNT + 1),
    (e: any) => e instanceof WalletGuardError && e.code === 'AMOUNT_EXCEEDS_CAP',
  );
  assert.doesNotThrow(() => validateEscrowAmount(50));
});
