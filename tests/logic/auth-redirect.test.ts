import test from 'node:test'
import assert from 'node:assert/strict'
import { safePostAuthPath } from '@/lib/auth-redirect'

test('post-auth redirects preserve safe local destinations', () => {
  assert.equal(safePostAuthPath('/marketplace?listing=service-1'), '/marketplace?listing=service-1')
  assert.equal(safePostAuthPath('/docs#trades'), '/docs#trades')
})

test('post-auth redirects reject external and recursive auth destinations', () => {
  assert.equal(safePostAuthPath('https://evil.example'), '/dashboard')
  assert.equal(safePostAuthPath('//evil.example/path'), '/dashboard')
  assert.equal(safePostAuthPath('/\\evil.example/path'), '/dashboard')
  assert.equal(safePostAuthPath('/auth/login'), '/dashboard')
  assert.equal(safePostAuthPath('/auth/register'), '/dashboard')
})
