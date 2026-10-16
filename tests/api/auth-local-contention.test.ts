import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let directory: string, path: string, db: typeof import('@/lib/db').db
let auth: typeof import('@/lib/auth'), moderation: typeof import('@/lib/agent-moderation')
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-auth-contention-'))
  path = join(directory, 'auth.db')
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${path}`, TURSO_AUTH_TOKEN: '', JWT_SECRET: 'controlled-auth-contention-only' })
  db = (await import('@/lib/db')).db
  await db.$client.execute('PRAGMA journal_mode=DELETE')
  await db.$client.execute('PRAGMA busy_timeout=0')
  const { createLocalTestSchema } = await import('../helpers/local-schema')
  const schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  await db.insert(schema.users).values({ id: 'banned-fixture', email: 'banned-fixture@test.invalid', password_hash: 'controlled-unused-no-login', name: 'Controlled banned fixture', role: 'human' })
  await db.$client.execute("INSERT INTO banned_users VALUES ('banned-fixture', 'controlled', 1)")
  auth = await import('@/lib/auth'); moderation = await import('@/lib/agent-moderation')
})
after(async () => { db?.$client.close(); if (directory) await rm(directory, { recursive: true, force: true }) })

async function exclusiveLock(seconds: number) {
  const child = spawn('python3', ['-c', `import sqlite3,sys,time
c=sqlite3.connect(sys.argv[1]);c.execute('BEGIN EXCLUSIVE')
print('LOCKED',flush=True);time.sleep(float(sys.argv[2]));c.rollback();c.close()
`, path, String(seconds)], { stdio: ['ignore', 'pipe', 'pipe'] })
  let error = ''
  child.stderr.on('data', chunk => { error += String(chunk) })
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(Error(`Controlled lock failed: ${error}`)))
  })
  await new Promise<void>((resolve, reject) => {
    child.stdout.once('data', chunk => String(chunk).includes('LOCKED') ? resolve() : reject(Error('Lock barrier missing')))
    child.once('error', reject)
  })
  return { exited, stop: async () => { if (child.exitCode === null) child.kill('SIGKILL'); await exited.catch(() => undefined) } }
}

test('real exclusive SQLite lock reproduces the old ban-read failure and bounded fresh reads preserve denial', async () => {
  const lock = await exclusiveLock(0.35)
  try {
    await assert.rejects(db.$client.execute("SELECT user_id FROM banned_users WHERE user_id='banned-fixture'"), /SQLITE_BUSY|database is locked/)
    const token = auth.generateJWT({ userId: 'banned-fixture', role: 'human', email: 'controlled@test.invalid' })
    assert.equal(await auth.authenticateRequest(`Bearer ${token}`), null, 'a recovered read still denies the banned actor')
    await lock.exited
    assert.equal(await moderation.isUserBanned('banned-fixture'), true)
    assert.equal(await moderation.isUserBanned('unknown-fixture'), false)
  } finally { await lock.stop() }
})

test('exhausted ban-read contention stays unavailable and never authenticates or reports an unbanned actor', async () => {
  const lock = await exclusiveLock(2)
  try {
    await assert.rejects(moderation.isUserBanned('banned-fixture'), /SQLITE_BUSY|database is locked/)
    await lock.exited
    assert.equal(await moderation.isUserBanned('banned-fixture'), true)
    const count = await db.$client.execute('SELECT COUNT(*) AS total FROM banned_users')
    assert.equal(Number(count.rows[0].total), 1, 'read recovery performs no moderation or financial writes')
  } finally { await lock.stop() }
})

test('route-mandate preflight recovers a real exclusive lock without minting missing authority', async () => {
  const { validateRouteMandate, RouteMandateError } = await import('@/lib/route-payment-mandate')
  const plan = { id: crypto.randomUUID(), buyer_id: 'controlled-absent-buyer' } as Parameters<typeof validateRouteMandate>[1]
  const lock = await exclusiveLock(0.35)
  try {
    await assert.rejects(db.$client.execute('SELECT id FROM route_payment_mandates LIMIT 1'), /SQLITE_BUSY|database is locked/)
    await assert.rejects(validateRouteMandate(crypto.randomUUID(), plan),
      error => error instanceof RouteMandateError && error.code === 'MANDATE_NOT_FOUND' && error.status === 404)
    await lock.exited
    const count = await db.$client.execute('SELECT COUNT(*) AS total FROM route_payment_mandates')
    assert.equal(Number(count.rows[0].total), 0, 'read recovery creates no mandate, reservation or payment authority')
  } finally { await lock.stop() }
})
