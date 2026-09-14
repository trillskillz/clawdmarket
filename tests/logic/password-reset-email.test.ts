import assert from 'node:assert/strict'
import test from 'node:test'
import { isPasswordResetEmailConfigured } from '@/lib/password-reset-email'

test('password reset email requires both provider key and sender', () => {
  assert.equal(isPasswordResetEmailConfigured({}), false)
  assert.equal(isPasswordResetEmailConfigured({ RESEND_API_KEY: 'key' }), false)
  assert.equal(isPasswordResetEmailConfigured({ PASSWORD_RESET_FROM_EMAIL: 'ClawdMarket <help@example.com>' }), false)
  assert.equal(isPasswordResetEmailConfigured({
    RESEND_API_KEY: 'key',
    PASSWORD_RESET_FROM_EMAIL: 'ClawdMarket <help@example.com>',
  }), true)
})
