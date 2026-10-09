import { test, expect } from '@playwright/test'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import jwt from 'jsonwebtoken'

test('external Python CLI survives process death after HTTP report commit and leaves settlement to the buyer', async ({ request, page, baseURL }) => {
  test.setTimeout(60000)
  expect(process.env.TURSO_DATABASE_URL).toMatch(/^file:\/tmp\/clawdmarket-workspace-test-/)
  expect(process.env.TURSO_AUTH_TOKEN || '').toBe('')
  const registered = await request.post('/api/agents/register', { headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65536).toString(16)}::140` },
    data: { name: `Python verifier ${Date.now()}`, activation_mode: 'autonomous', capabilities: ['code-review'] } })
  expect(registered.status()).toBe(201)
  const verifier = (await registered.json()).agent
  const seeded = await promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'e2e/fixtures/python-verifier.ts', verifier.id], { env: { ...process.env }, timeout: 20000 })
  const { trade_id: tradeId, buyer_id: buyerId, seller_id: sellerId, suite } = JSON.parse(seeded.stdout)
  const token = (id: string) => ({ Authorization: `Bearer ${jwt.sign({ userId: id, email: `${id}@test.invalid`, role: 'human' }, process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret', { algorithm: 'HS256', expiresIn: '5m' })}` })
  const buyer = token(buyerId), seller = token(sellerId), code = 'def run(value):\n    return value\n'
  const uploaded = await request.post(`/api/trades/${tradeId}/artifacts`, { headers: seller, data: { client_reference: crypto.randomUUID(), name: 'solution.py', media_type: 'text/plain', content_base64: Buffer.from(code).toString('base64'), sha256: createHash('sha256').update(code).digest('hex') } })
  expect(uploaded.status()).toBe(201)
  const artifactId = (await uploaded.json()).artifact.id
  const create = { client_reference: crypto.randomUUID(), artifact_id: artifactId, test_suite: suite }
  const created = await request.post(`/api/trades/${tradeId}/verification-jobs`, { headers: buyer, data: create })
  expect(created.status()).toBe(201)
  const job = (await created.json()).job, path = `/api/verification-jobs/${job.id}`
  expect(job.policy.adapter).toBe('python_tests_v1')
  expect((await request.get(path)).status()).toBe(401)
  expect((await (await request.get(path, { headers: buyer })).json()).test_suite).toBeUndefined()
  expect((await request.get(`${path}/artifact`, { headers: seller })).status()).toBe(403)
  const stateDirectory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-python-cli-'))
  let active: ChildProcess | undefined, killed = false, downloads = 0, posts = 0
  // The proxy forwards only this local job, then kills our own CLI process group
  // after the server commits its first report but before it receives the reply.
  const proxy = createServer(async (incoming, outgoing) => {
    try {
      if (![path, `${path}/artifact`].includes(incoming.url || '') || !['GET', 'POST'].includes(incoming.method || '')) { outgoing.writeHead(404).end(); return }
      const chunks: Buffer[] = []
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
      if (Buffer.concat(chunks).length > 8192) { outgoing.writeHead(413).end(); return }
      if (incoming.url!.endsWith('/artifact')) downloads++
      if (incoming.method === 'POST') posts++
      const response = await fetch(`${baseURL}${incoming.url}`, { method: incoming.method, redirect: 'error',
        headers: { Authorization: incoming.headers.authorization || '', 'Content-Type': 'application/json' },
        ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) })
      if (incoming.method === 'POST' && response.ok && !killed) {
        killed = true
        process.kill(-active!.pid!, 'SIGKILL')
        await response.body?.cancel(); outgoing.destroy(); return
      }
      outgoing.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/json' })
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch { outgoing.destroy() }
  })
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done))
  const origin = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`
  const run = () => new Promise<{ code: number | null; signal: string | null; stdout: string }>((resolve, reject) => {
    active = spawn(process.execPath, ['scripts/verification-worker.mjs', job.id, stateDirectory], { detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BASE_URL: origin, CLAWDMARKET_VERIFIER_API_KEY: verifier.api_key } })
    let stdout = ''
    active.stdout!.on('data', (chunk) => { stdout += chunk.toString() })
    active.stderr!.resume()
    const child = active
    const timer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL') } catch {} }, 20000)
    active.once('error', (error) => { clearTimeout(timer); reject(error) })
    active.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout }) })
  })
  try {
    expect((await run()).signal).toBe('SIGKILL')
    expect(killed).toBe(true)
    const committed = (await (await request.get(path, { headers: buyer })).json()).job
    expect(committed.state).toBe('passed')
    expect(committed.provenance.isolation_observed_by_app).toBe(false)
    const resumed = await run()
    expect(resumed.code).toBe(0)
    expect(JSON.parse(resumed.stdout)).toMatchObject({ state: 'passed', report_hash: committed.report_hash, idempotent: true })
    expect(downloads).toBe(1); expect(posts).toBe(2)
    const files = (await readdir(stateDirectory)).filter((name) => name.endsWith('.json'))
    expect(files).toHaveLength(1)
    const journal = await readFile(join(stateDirectory, files[0]), 'utf8')
    for (const secret of ['PRIVATE_PYTHON_CASE', verifier.api_key, code]) expect(journal).not.toContain(secret)
    expect((await stat(join(stateDirectory, files[0]))).mode & 0o777).toBe(0o600)
    expect((await request.get(`${path}/artifact`, { headers: { Authorization: `Bearer ${verifier.api_key}` } })).status()).toBe(409)
    const payload = { summary: 'Python module passed the agreed finite cases.', artifact_ids: [artifactId], verification_job_id: job.id }
    expect((await request.post(`/api/trades/${tradeId}/delivery`, { headers: seller, data: payload })).status()).toBe(201)
    const pending = await (await request.get(`/api/trades/${tradeId}/verification`, { headers: buyer })).json()
    expect(pending.acceptance).toMatchObject({ mode: 'explicit_buyer', accepted: false, auto_confirm_enabled: false })
    expect(pending.categories).toMatchObject({ deterministic_tests_passed: true, static_analysis_passed: false, semantic_verified: false, buyer_accepted: false })
    expect((await request.post(`/api/trades/${tradeId}/confirm`, { headers: buyer, data: {} })).status()).toBe(200)
    expect((await request.post(`/api/trades/${tradeId}/delivery`, { headers: seller, data: payload })).status()).toBe(200)
    const accepted = await (await request.get(`/api/trades/${tradeId}/verification`, { headers: buyer })).json()
    expect(accepted.acceptance.accepted).toBe(true)
    expect(JSON.stringify(accepted)).not.toContain('PRIVATE_PYTHON_CASE')
    const manifest = await (await request.get('/.well-known/clawdmarket.json')).json()
    expect(manifest.isolated_verification.adapters).toContain('python_tests_v1')
    await page.goto('/docs')
    await expect(page.getByText(/For agreed Python verification/)).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  } finally {
    if (active?.exitCode === null && active.signalCode === null) { try { process.kill(-active.pid!, 'SIGKILL') } catch {} }
    await new Promise<void>((done) => proxy.close(() => done()))
    await rm(stateDirectory, { recursive: true, force: true })
  }
})
