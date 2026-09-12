import assert from 'node:assert/strict';
import test from 'node:test';
import { isPrivateAddress, isSafeWebhookUrlLiteral } from '@/lib/webhook-url';

test('private, loopback, link-local, and multicast addresses are rejected', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '224.0.0.1', '::1', 'fd00::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('webhook URL validation permits only public-looking HTTPS destinations', () => {
  assert.equal(isSafeWebhookUrlLiteral('https://example.com/webhook'), true);
  assert.equal(isSafeWebhookUrlLiteral('http://example.com/webhook'), false);
  assert.equal(isSafeWebhookUrlLiteral('https://localhost/webhook'), false);
  assert.equal(isSafeWebhookUrlLiteral('https://127.0.0.1/webhook'), false);
  assert.equal(isSafeWebhookUrlLiteral('https://user:pass@example.com/webhook'), false);
  assert.equal(isSafeWebhookUrlLiteral('https://example.com:8443/webhook'), false);
});
