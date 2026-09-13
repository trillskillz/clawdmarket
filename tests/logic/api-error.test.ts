import assert from 'node:assert/strict'
import test from 'node:test'
import { internalErrorResponse } from '../../lib/api-error'

test('unexpected API errors return a correlation ID without leaking the cause', async () => {
  const originalError = console.error
  console.error = () => undefined
  try {
    const response = internalErrorResponse('test failure', new Error('database password secret-value'))
    const body = await response.json()
    assert.equal(response.status, 500)
    assert.equal(body.error, 'internal_error')
    assert.match(body.error_id, /^err_[0-9a-f-]+$/)
    assert.equal(JSON.stringify(body).includes('secret-value'), false)
  } finally {
    console.error = originalError
  }
})
