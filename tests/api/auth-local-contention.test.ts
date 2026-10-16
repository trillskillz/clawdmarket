import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const workerCase = process.env.CLAWDMARKET_TEST_AUTH_CONTENTION_CASE
const execute = promisify(execFile)
// Native SQLite statements from a previous case may await garbage collection.
// Each control needs its own process/database so its EXCLUSIVE precondition
// cannot inherit another case's connection or statement lifetime.
function contentionTest(name: string, run: () => Promise<void>) {
  if (workerCase) {
    if (workerCase === name) test(name, run)
    return
  }
  test(name, async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, CLAWDMARKET_TEST_AUTH_CONTENTION_CASE: name }
    // A nested runner needs its own reporter, not the parent's IPC protocol.
    delete env.NODE_TEST_CONTEXT
    const { stdout } = await execute(process.execPath, [
      '--conditions=react-server', '--import', 'tsx', '--test', '--test-reporter=tap', fileURLToPath(import.meta.url),
    ], { env, timeout: 30_000, maxBuffer: 1024 * 1024 })
    assert.match(stdout, /^# tests 1$/m, 'the child must execute its actual named control')
    assert.match(stdout, /^# pass 1$/m)
    assert.match(stdout, /^# fail 0$/m)
    assert.match(stdout, /^# skipped 0$/m)
  })
}

let directory: string, path: string, db: typeof import('@/lib/db').db
let auth: typeof import('@/lib/auth'), moderation: typeof import('@/lib/agent-moderation')
before(async () => {
  if (!workerCase) return
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
  await db.insert(schema.payout_addresses).values({ user_id: 'banned-fixture', address: `0x${'11'.repeat(20)}` })
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
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.once('data', chunk => String(chunk).includes('LOCKED') ? resolve() : reject(Error('Lock barrier missing')))
    child.once('error', reject)
  })
  const stop = async () => { if (child.exitCode === null) child.kill('SIGKILL'); await exited.catch(() => undefined) }
  try {
    await Promise.race([ready, exited.then(() => { throw Error('Lock process exited before its barrier') })])
  } catch (error) { await stop(); throw error }
  return { exited, stop }
}

contentionTest('real exclusive SQLite lock reproduces the old ban-read failure and bounded fresh reads preserve denial', async () => {
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

contentionTest('exhausted ban-read contention stays unavailable and never authenticates or reports an unbanned actor', async () => {
  const lock = await exclusiveLock(2)
  try {
    await assert.rejects(moderation.isUserBanned('banned-fixture'), /SQLITE_BUSY|database is locked/)
    await lock.exited
    assert.equal(await moderation.isUserBanned('banned-fixture'), true)
    const count = await db.$client.execute('SELECT COUNT(*) AS total FROM banned_users')
    assert.equal(Number(count.rows[0].total), 1, 'read recovery performs no moderation or financial writes')
  } finally { await lock.stop() }
})

contentionTest('route-mandate preflight recovers a real exclusive lock without minting missing authority', async () => {
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


contentionTest('payout lookup recovers a real exclusive lock without treating a configured seller as missing', async () => {
  const { payoutAddressForUser } = await import('@/lib/external-settlement')
  const address = `0x${'11'.repeat(20)}`
  const lock = await exclusiveLock(0.35)
  try {
    await assert.rejects(db.$client.execute('SELECT address FROM payout_addresses LIMIT 1'), /SQLITE_BUSY|database is locked/)
    assert.equal(await payoutAddressForUser('banned-fixture'), address)
    await lock.exited
  } finally { await lock.stop() }
})

contentionTest('exhausted payout lookup stays unavailable and preserves the original seller address', async () => {
  const { payoutAddressForUser } = await import('@/lib/external-settlement')
  const { isLocalSqliteContention } = await import('@/lib/local-sqlite-read')
  const lock = await exclusiveLock(2)
  try {
    await assert.rejects(payoutAddressForUser('banned-fixture'), error => error instanceof Error && isLocalSqliteContention(error))
    await lock.exited
    assert.equal(await payoutAddressForUser('banned-fixture'), `0x${'11'.repeat(20)}`)
  } finally { await lock.stop() }
})

contentionTest('workflow preparation reports contended reads as recoverable without replaying the command or creating authority', async () => {
  const { prepareWorkflowNode } = await import('@/lib/workflow-execution-budget')
  const { WorkflowApprovalError } = await import('@/lib/workflow-approval')
  const run = crypto.randomUUID()
  const lock = await exclusiveLock(0.35)
  try {
    await assert.rejects(prepareWorkflowNode(run, 'controlled-absent-node', 'controlled-absent-buyer'),
      error => error instanceof WorkflowApprovalError && error.code === 'WORKFLOW_APPROVAL_STORAGE_BUSY' && error.status === 503)
    await lock.exited
    await assert.rejects(prepareWorkflowNode(run, 'controlled-absent-node', 'controlled-absent-buyer'),
      error => error instanceof Error && 'code' in error && error.code === 'WORKFLOW_NOT_FOUND')
    const count = await db.$client.execute('SELECT COUNT(*) AS total FROM workflow_runs')
    assert.equal(Number(count.rows[0].total), 0, 'storage status cannot create a workflow, child or payment authority')
  } finally { await lock.stop() }
})
