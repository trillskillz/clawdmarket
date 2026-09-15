import assert from 'node:assert/strict'
import test from 'node:test'
import jwt from 'jsonwebtoken'
import { generateJWT, verifyJWT } from '../../lib/auth'

test('application sessions use and accept only HS256', () => {
  const previousSecret = process.env.JWT_SECRET
  process.env.JWT_SECRET = 'auth-security-test-secret-with-sufficient-entropy'
  try {
    const payload = { userId: 'user-1', email: 'user@example.test', role: 'human' as const }
    const token = generateJWT(payload)
    assert.equal((jwt.decode(token, { complete: true }) as any)?.header?.alg, 'HS256')
    assert.equal(verifyJWT(token)?.userId, payload.userId)

    const alternateAlgorithm = jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS512', expiresIn: '1h' })
    assert.equal(verifyJWT(alternateAlgorithm), null)
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = previousSecret
  }
})
