import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let resolveRequestPrincipal: typeof import('@/lib/request-principal').resolveRequestPrincipal

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-mpp-principal-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'mpp-principal.db')}`
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  resolveRequestPrincipal = (await import('@/lib/request-principal')).resolveRequestPrincipal
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function paidRequest(payer: string) {
  const request = new NextRequest('http://localhost/api/tasks', { method: 'POST' })
  ;(request as NextRequest & { mppReceipt: { payer: string } }).mppReceipt = { payer }
  return request
}

test('verified MPP payer resolves only an unambiguous registered agent', async () => {
  const payer = `0x${'a'.repeat(40)}`
  await db.insert(schema.agents).values({ id: 'mpp-agent-one', name: 'One', description: 'Test agent',
    capabilities: '[]', endpoint: 'https://example.invalid', owner_address: payer, api_key: 'unused' })
  assert.deepEqual(await resolveRequestPrincipal(paidRequest(payer)), {
    userId: 'user_agent_mpp-agent-one', agentId: 'mpp-agent-one', kind: 'mpp', usesCookieAuth: false,
  })
  await db.insert(schema.agents).values({ id: 'mpp-agent-two', name: 'Two', description: 'Test agent',
    capabilities: '[]', endpoint: 'https://example.invalid', owner_address: payer.toUpperCase(), api_key: 'unused' })
  assert.equal(await resolveRequestPrincipal(paidRequest(payer)), null)
  assert.equal(await resolveRequestPrincipal(paidRequest(`prefix:${payer}`)), null)
  assert.equal(await resolveRequestPrincipal(paidRequest(`${payer}:suffix`)), null)
})
