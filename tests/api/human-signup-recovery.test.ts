import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let register: typeof import('@/app/api/auth/register/route').POST
let forgot: typeof import('@/app/api/auth/forgot-password/route')
let reset: typeof import('@/app/api/auth/reset-password/route').POST
let passwordReset: typeof import('@/lib/password-reset')
let verifyPassword: typeof import('@/lib/auth').verifyPassword
let userId: string

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-human-recovery-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'human-recovery.db')}`
  delete process.env.RESEND_API_KEY
  delete process.env.PASSWORD_RESET_FROM_EMAIL
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  await db.$client.execute('CREATE UNIQUE INDEX IF NOT EXISTS human_recovery_user_ips_unique ON user_ips(user_id, ip)')
  register = (await import('@/app/api/auth/register/route')).POST
  forgot = await import('@/app/api/auth/forgot-password/route')
  reset = (await import('@/app/api/auth/reset-password/route')).POST
  passwordReset = await import('@/lib/password-reset')
  verifyPassword = (await import('@/lib/auth')).verifyPassword
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
  delete process.env.RESEND_API_KEY
  delete process.env.PASSWORD_RESET_FROM_EMAIL
})

function request(path: string, body: unknown, ip: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

test('human registration starts with no credit or faucet transaction', async () => {
  const response = await register(request('/api/auth/register', {
    email: 'human-recovery@test.invalid', password: 'InitialPassword123', name: 'New Human', role: 'human',
  }, '2001:db8::301'))
  assert.equal(response.status, 201)
  const body = await response.json()
  assert.equal(body.user.role, 'human')
  userId = body.user.id
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.user_id, userId))
  assert.equal(wallet.balance, 0)
  assert.equal(wallet.escrow, 0)
  assert.equal((await db.select().from(schema.transactions)).length, 0)
})

test('password recovery fails closed without a configured sender', async () => {
  assert.equal((await (await forgot.GET()).json()).configured, false)
  const response = await forgot.POST(request('/api/auth/forgot-password', { email: 'human-recovery@test.invalid' }, '2001:db8::302'))
  assert.equal(response.status, 503)
  assert.equal((await db.select().from(schema.password_reset_tokens)).length, 0)
})

test('a newer reset token replaces older links and can only change a password once', async () => {
  const oldToken = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  await passwordReset.storeResetToken(oldToken, userId)
  await passwordReset.storeResetToken(token, userId)
  const previous = await reset(request('/api/auth/reset-password', { token: oldToken, password: 'ReplacementPassword123' }, '2001:db8::303'))
  assert.equal(previous.status, 400)
  const response = await reset(request('/api/auth/reset-password', { token, password: 'ReplacementPassword123' }, '2001:db8::304'))
  assert.equal(response.status, 200)
  const repeated = await reset(request('/api/auth/reset-password', { token, password: 'AnotherPassword123' }, '2001:db8::305'))
  assert.equal(repeated.status, 400)
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId))
  assert.equal(await verifyPassword('ReplacementPassword123', user.password_hash), true)
  assert.equal(await verifyPassword('AnotherPassword123', user.password_hash), false)
  assert.equal((await db.select().from(schema.password_reset_tokens)).length, 0)
})

test('configured recovery sends a link and revokes it if email delivery fails', async () => {
  process.env.RESEND_API_KEY = 'test-only-api-key'
  process.env.PASSWORD_RESET_FROM_EMAIL = 'ClawdMarket <recovery@clawdmkt.com>'
  const originalFetch = globalThis.fetch
  let sentTo = ''
  try {
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body))
      sentTo = body.to[0]
      assert.match(body.text, /\/auth\/reset-password\?token=[a-f0-9]{64}/)
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    assert.equal((await (await forgot.GET()).json()).configured, true)
    const sent = await forgot.POST(request('/api/auth/forgot-password', { email: 'human-recovery@test.invalid' }, '2001:db8::306'))
    assert.equal(sent.status, 200)
    assert.equal(sentTo, 'human-recovery@test.invalid')
    assert.equal((await db.select().from(schema.password_reset_tokens)).length, 1)

    globalThis.fetch = (async () => new Response('{}', { status: 503 })) as typeof fetch
    const failed = await forgot.POST(request('/api/auth/forgot-password', { email: 'human-recovery@test.invalid' }, '2001:db8::307'))
    assert.equal(failed.status, 200)
    assert.equal((await db.select().from(schema.password_reset_tokens)).length, 0)
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.RESEND_API_KEY
    delete process.env.PASSWORD_RESET_FROM_EMAIL
  }
})
