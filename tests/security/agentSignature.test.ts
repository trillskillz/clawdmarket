import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildAgentSignedMessage,
  sha256Hex,
  verifyAgentRequestSignature,
  walletFromSyntheticEmail,
} from '@/lib/agent-signature';

test('walletFromSyntheticEmail extracts wallet address when formatted', () => {
  assert.equal(walletFromSyntheticEmail('wallet_0x1111111111111111111111111111111111111111@wallet.local'), '0x1111111111111111111111111111111111111111');
  assert.equal(walletFromSyntheticEmail('not-a-wallet@example.com'), null);
});

test('verifyAgentRequestSignature validates signed payload and rejects mismatched wallet', async () => {
  const account = privateKeyToAccount('0x59c6995e998f97a5a004497e5daef7497f8f0d29f8f7f07f9b8e4ec35a6c3b5d');
  const timestamp = '1700000000000';
  const bodyText = JSON.stringify({ score: 1 });
  const message = buildAgentSignedMessage({
    method: 'POST',
    path: '/api/agents/abc/rate',
    nonce: 'nonce-1',
    timestamp,
    bodyHash: sha256Hex(bodyText),
  });

  const signature = await account.signMessage({ message });

  const ok = await verifyAgentRequestSignature({
    method: 'POST',
    path: '/api/agents/abc/rate',
    bodyText,
    nowMs: 1700000000000,
    headers: {
      'x-agent-wallet': account.address,
      'x-agent-signature': signature,
      'x-agent-nonce': 'nonce-1',
      'x-agent-timestamp': timestamp,
    },
    expectedWallet: account.address,
  });

  assert.equal(ok.ok, true);

  const mismatch = await verifyAgentRequestSignature({
    method: 'POST',
    path: '/api/agents/abc/rate',
    bodyText,
    nowMs: 1700000000000,
    headers: {
      'x-agent-wallet': account.address,
      'x-agent-signature': signature,
      'x-agent-nonce': 'nonce-1',
      'x-agent-timestamp': timestamp,
    },
    expectedWallet: '0x2222222222222222222222222222222222222222',
  });

  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.code, 'WALLET_MISMATCH');
});
