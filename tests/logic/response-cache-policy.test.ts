import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldDisableSharedCaching } from '../../lib/response-cache-policy'

test('credential-bearing requests and private API routes disable shared caching', () => {
  assert.equal(shouldDisableSharedCaching('/api/listings', new Headers({ Authorization: 'Bearer example' }), false), true)
  assert.equal(shouldDisableSharedCaching('/marketplace', new Headers(), true), true)
  assert.equal(shouldDisableSharedCaching('/api/auth/wallet/verify', new Headers(), false), true)
  assert.equal(shouldDisableSharedCaching('/api/agents/register/example', new Headers(), false), false)
  assert.equal(shouldDisableSharedCaching('/api/agents/register', new Headers(), false), true)
  assert.equal(shouldDisableSharedCaching('/api/payments/payout-address', new Headers(), false), true)
})

test('public discovery and catalog requests remain cacheable by route policy', () => {
  assert.equal(shouldDisableSharedCaching('/api/listings', new Headers(), false), false)
  assert.equal(shouldDisableSharedCaching('/api/agents/list', new Headers(), false), false)
  assert.equal(shouldDisableSharedCaching('/.well-known/agent.json', new Headers(), false), false)
})
