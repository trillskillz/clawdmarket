import test from 'node:test'
import assert from 'node:assert/strict'
import { evidenceQueryDiagnostic } from '../../lib/evidence-query-diagnostic'

test('compiler diagnostics retain fixed categories without private suffixes', () => {
  assert.equal(evidenceQueryDiagnostic('SQLite error: circular reference: PRIVATE-BUYER-SECRET', 'SELECT 1'), 'circular reference')
  assert.equal(evidenceQueryDiagnostic('at most 64 tables in a join https://PRIVATE-TOKEN@database.example', 'SELECT 1'), 'tables in a join')
})

test('schema diagnostics report only identifiers from the fixed query', () => {
  assert.equal(evidenceQueryDiagnostic('no such column: scope_order.execution_contract_json', 'SELECT scope_order.execution_contract_json'), 'no such column: scope_order.execution_contract_json')
  assert.doesNotMatch(evidenceQueryDiagnostic('no such table: PRIVATE_CUSTOMER_123', 'SELECT 1'), /PRIVATE|CUSTOMER|123/)
})

test('unknown compiler messages redact transport URLs, credentials, identities and numbers', () => {
  const output = evidenceQueryDiagnostic('SQLite error: unsupported operation PRIVATE_CUSTOMER_123 sk-PRIVATE-CREDENTIAL 987654 https://secret@database.example/path?token=PRIVATE_TOKEN wss://private.example libsql://private.example', 'SELECT e.capability_id FROM events e')
  assert.match(output, /unsupported operation/)
  assert.doesNotMatch(output, /PRIVATE|CUSTOMER|CREDENTIAL|987654|secret|database|example|token=|https|wss|libsql/)
  assert.ok(output.includes('[redacted]'))
})
