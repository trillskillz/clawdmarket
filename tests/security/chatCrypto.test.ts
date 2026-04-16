import test from 'node:test';
import assert from 'node:assert/strict';

process.env.CHAT_ENCRYPTION_KEY = 'test-key-for-unit-tests-only';

const { encryptMessage, decryptMessage } = await import('@/lib/chat-crypto');

test('encryptMessage returns encrypted_content and nonce as base64 strings', async () => {
  const result = await encryptMessage('hello world');
  assert.ok(result.encrypted_content, 'encrypted_content should exist');
  assert.ok(result.nonce, 'nonce should exist');
  assert.ok(result.encrypted_content.length > 0);
  assert.ok(result.nonce.length > 0);
  assert.notEqual(result.encrypted_content, 'hello world');
});

test('decryptMessage recovers original plaintext', async () => {
  const plaintext = 'the quick brown fox jumps over the lazy dog';
  const { encrypted_content, nonce } = await encryptMessage(plaintext);
  const recovered = await decryptMessage(encrypted_content, nonce);
  assert.equal(recovered, plaintext);
});

test('different messages produce different ciphertexts', async () => {
  const a = await encryptMessage('message A');
  const b = await encryptMessage('message B');
  assert.notEqual(a.encrypted_content, b.encrypted_content);
});

test('different encryptions of same message produce different nonces', async () => {
  const a = await encryptMessage('same message');
  const b = await encryptMessage('same message');
  assert.notEqual(a.nonce, b.nonce);
});

test('decryption with wrong nonce throws', async () => {
  const { encrypted_content } = await encryptMessage('secret');
  const { nonce: wrongNonce } = await encryptMessage('other');
  await assert.rejects(
    () => decryptMessage(encrypted_content, wrongNonce),
    'Should throw on wrong nonce'
  );
});

test('decryption with corrupted ciphertext throws', async () => {
  const { nonce } = await encryptMessage('secret');
  const corruptedContent = Buffer.from('corrupted-data').toString('base64');
  await assert.rejects(
    () => decryptMessage(corruptedContent, nonce),
    'Should throw on corrupted ciphertext'
  );
});

test('handles empty string', async () => {
  const { encrypted_content, nonce } = await encryptMessage('');
  const recovered = await decryptMessage(encrypted_content, nonce);
  assert.equal(recovered, '');
});

test('handles unicode content', async () => {
  const unicode = 'Hello from ClawdMarket! Lobster emoji test. Chinese text test.';
  const { encrypted_content, nonce } = await encryptMessage(unicode);
  const recovered = await decryptMessage(encrypted_content, nonce);
  assert.equal(recovered, unicode);
});
