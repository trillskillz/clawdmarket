import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let jwt: typeof import('@/lib/auth').generateJWT
let create: typeof import('@/app/api/workflows/plan/route').POST
let inspect: typeof import('@/app/api/workflows/[id]/route').GET
let cancel: typeof import('@/app/api/workflows/[id]/route').DELETE

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-workflows-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'workflows.db')}`
  process.env.JWT_SECRET = 'workflow-test-secret'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  create = (await import('@/app/api/workflows/plan/route')).POST
  ;({ GET: inspect, DELETE: cancel } = await import('@/app/api/workflows/[id]/route'))
  await db.insert(schema.users).values([
    { id: 'workflow-buyer', email: 'workflow-buyer@test.invalid', name: 'Buyer', password_hash: 'unused' },
    { id: 'workflow-outsider', email: 'workflow-outsider@test.invalid', name: 'Outsider', password_hash: 'unused' },
  ])
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function request(path: string, method: string, userId: string | null, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(userId ? { Authorization: `Bearer ${jwt({ userId, email: `${userId}@test.invalid`, role: 'human' })}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) })
}

function input(reference = crypto.randomUUID()) {
  return { client_reference: reference, objective: 'Review and improve the API security posture',
    max_budget: { amount: '20.00', currency: 'USD' }, deadline_seconds: 600,
    nodes: [
      { key: 'research', objective: 'Research the current API security requirements', required_capabilities: ['research'],
        budget: { amount: '5.00', currency: 'USD' }, deadline_seconds: 200, depends_on: [] },
      { key: 'review', objective: 'Review the API code and report vulnerabilities', required_capabilities: ['security', 'code-review'],
        budget: { amount: '10.00', currency: 'USD' }, deadline_seconds: 500, depends_on: ['research'] },
    ] }
}

test('bounded workflow plan is idempotent, buyer-only, cancellable, and moves no funds', async () => {
  const body = input()
  const anonymous = await create(request('/api/workflows/plan', 'POST', null, body))
  assert.equal(anonymous.status, 401)
  const created = await create(request('/api/workflows/plan', 'POST', 'workflow-buyer', body))
  assert.equal(created.status, 201, JSON.stringify(await created.clone().json()))
  const result = await created.json()
  assert.equal(result.workflow.max_budget.amount, '20.00')
  assert.equal(result.workflow.allocated_budget.amount, '15.00')
  assert.deepEqual(result.workflow.nodes.map((node: { key: string; depth: number }) => [node.key, node.depth]), [['research', 0], ['review', 1]])
  assert.deepEqual(result.workflow.nodes[1].required_capabilities, ['security-analysis', 'code-review'])
  assert.equal(result.workflow.execution_available, false)
  assert.equal(result.workflow.funds_moved, false)
  assert.equal((await db.select().from(schema.route_plans)).length, 0)
  assert.equal((await db.select().from(schema.trades)).length, 0)
  const replay = await create(request('/api/workflows/plan', 'POST', 'workflow-buyer', { ...body, nodes: [...body.nodes].reverse() }))
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).idempotent, true)
  const conflict = await create(request('/api/workflows/plan', 'POST', 'workflow-buyer', { ...body, max_budget: { amount: '21.00', currency: 'USD' } }))
  assert.equal(conflict.status, 409)
  const params = { params: Promise.resolve({ id: result.workflow.id }) }
  assert.equal((await inspect(request(`/api/workflows/${result.workflow.id}`, 'GET', 'workflow-outsider'), params)).status, 404)
  assert.equal((await cancel(request(`/api/workflows/${result.workflow.id}`, 'DELETE', 'workflow-outsider'), params)).status, 404)
  const cancelled = await cancel(request(`/api/workflows/${result.workflow.id}`, 'DELETE', 'workflow-buyer'), params)
  assert.equal((await cancelled.json()).workflow.state, 'cancelled')
  assert.equal((await cancel(request(`/api/workflows/${result.workflow.id}`, 'DELETE', 'workflow-buyer'), params)).status, 200)
  assert.equal((await inspect(request(`/api/workflows/${result.workflow.id}`, 'GET', 'workflow-buyer'), params)).status, 200)
  assert.equal((await db.select().from(schema.workflow_nodes)).length, 2)
})

test('workflow validation rejects budget overrun, cycles, unknown dependencies, depth, and impossible deadlines', async () => {
  const cases = [
    { changed: { nodes: input().nodes.map((node) => ({ ...node, budget: { amount: '15.00', currency: 'USD' } })) }, code: 'WORKFLOW_BUDGET_EXCEEDED' },
    { changed: { nodes: [{ ...input().nodes[0], depends_on: ['review'] }, input().nodes[1]] }, code: 'WORKFLOW_CYCLE' },
    { changed: { nodes: [{ ...input().nodes[0], depends_on: ['missing'] }, input().nodes[1]] }, code: 'WORKFLOW_UNKNOWN_DEPENDENCY' },
    { changed: { nodes: [{ ...input().nodes[0], deadline_seconds: 550 }, input().nodes[1]] }, code: 'WORKFLOW_DEPENDENCY_DEADLINE' },
  ]
  for (const { changed, code } of cases) {
    const response = await create(request('/api/workflows/plan', 'POST', 'workflow-buyer', { ...input(), ...changed }))
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error_code, code)
  }
  const chain = Array.from({ length: 5 }, (_, index) => ({ key: `node${index}`, objective: `Review stage ${index} of the security work`,
    required_capabilities: ['code-review'], budget: { amount: '1.00', currency: 'USD' },
    deadline_seconds: 100 * (index + 1), depends_on: index ? [`node${index - 1}`] : [] }))
  const tooDeep = await create(request('/api/workflows/plan', 'POST', 'workflow-buyer', { ...input(), nodes: chain }))
  assert.equal((await tooDeep.json()).error_code, 'WORKFLOW_DEPTH_LIMIT')
  assert.equal((await db.select().from(schema.workflows)).length, 1)
})
