import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import jwt from 'jsonwebtoken'

test('a separate grader completes a private versioned benchmark over HTTP and recovers its immutable result', async ({ request, page, baseURL }) => {
  const execute = promisify(execFile)
  const grader = 'trusted-benchmark-browser-grader', admin = 'benchmark-browser-admin', key = 'clawd_benchmark_browser_fixture_key'
  const jwtSecret = process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret'
  // This fixture can write only to an explicitly disposable local test database.
  expect(process.env.TURSO_DATABASE_URL).toMatch(/^file:\/tmp\/clawdmarket-workspace-test-/)
  await execute(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e', `
    if (!process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-')) throw Error('Local test database required');
    const {db}=await import('./lib/db.ts'); const s=await import('./lib/schema.ts'); const {hashAgentApiKey}=await import('./lib/registered-agent-auth.ts');
    await db.insert(s.users).values({id:'${admin}',name:'Browser benchmark admin',email:'benchmark-admin@test.invalid',password_hash:'unused',role:'human'}).onConflictDoNothing();
    await db.insert(s.agents).values({id:'${grader}',name:'Browser fixture grader',description:'Controlled fixture grader',capabilities:'["data-extraction"]',endpoint:'',owner_address:'',api_key:hashAgentApiKey('${key}')}).onConflictDoNothing();
    db.$client.close();
  `], { env: { ...process.env, JWT_SECRET: jwtSecret, AGENT_API_KEY_PEPPER: process.env.AGENT_API_KEY_PEPPER || 'clawdmarket-playwright-agent-pepper' }, timeout: 20000 })
  const adminHeaders = { Authorization: `Bearer ${jwt.sign({ userId: admin, email: 'benchmark-admin@test.invalid', role: 'human' }, jwtSecret, { algorithm: 'HS256', expiresIn: '5m' })}` }
  const registered = await request.post('/api/agents/register', { headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65536).toString(16)}::90` },
    data: { name: `Benchmark target ${Date.now()}`, activation_mode: 'autonomous', capabilities: ['data-extraction'] } })
  expect(registered.status()).toBe(201)
  const target = (await registered.json()).agent, targetHeaders = { Authorization: `Bearer ${target.api_key}` }
  const suite = { suite_key: `browser-${crypto.randomUUID()}`, version: 1, title: 'Browser exact extraction suite', capability_id: 'data-extraction',
    grader_agent_id: grader, adapter: 'json_exact_v1', cases: [{ id: 'a', input: 'PRIVATE_BROWSER_INPUT', expected: 'PRIVATE_BROWSER_EXPECTED' }, { id: 'b', input: 'Two ordered values', expected: [1, 2] }] }
  const published = await request.post('/api/admin/benchmark-definitions', { headers: adminHeaders, data: suite })
  expect(published.status()).toBe(201)
  const definition = (await published.json()).definition
  const catalog = await (await request.get('/api/benchmark-definitions?capability=data-extraction')).json()
  expect(catalog.definitions.some((entry: { id: string }) => entry.id === definition.id)).toBe(true)
  expect(JSON.stringify(catalog)).not.toContain('PRIVATE_BROWSER')
  const create = { definition_id: definition.id, client_reference: crypto.randomUUID() }
  const created = await request.post('/api/benchmark-runs', { headers: targetHeaders, data: create })
  expect(created.status()).toBe(201)
  const run = (await created.json()).run, path = `/api/benchmark-runs/${run.id}`
  expect((await request.get(path)).status()).toBe(401)
  const input = await request.get(path, { headers: targetHeaders })
  expect(input.headers()['cache-control']).toContain('no-store')
  const material = await input.json()
  expect(material.test_cases[0].input).toBe('PRIVATE_BROWSER_INPUT')
  expect(JSON.stringify(material)).not.toContain('PRIVATE_BROWSER_EXPECTED')
  const submission = await request.post(`${path}/submission`, { headers: targetHeaders, data: { outputs: [{ id: 'b', output: [1, 2] }, { id: 'a', output: 'wrong' }] } })
  expect(submission.status()).toBe(200)
  const stateDirectory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-browser-grader-'))
  try {
    const grade = async () => JSON.parse((await execute(process.execPath, ['scripts/trusted-benchmark-worker.mjs', run.id, stateDirectory],
      { env: { ...process.env, BASE_URL: baseURL!, CLAWDMARKET_BENCHMARK_GRADER_API_KEY: key }, timeout: 20000 })).stdout.trim())
    const original = await grade(), recovered = await grade()
    expect(original.state).toBe('graded'); expect(original.reused).toBe(false)
    expect(recovered.report_hash).toBe(original.report_hash); expect(recovered.reused).toBe(true)
    const result = await (await request.get(path, { headers: targetHeaders })).json()
    expect(result.run.observation).toEqual({ passed_count: 1, total_count: 2, exact_match_percent: 50 })
    expect(result.run.evidence.measured_quality_score).toBeNull()
    expect(result.run.evidence.independence).toBe('not_verified')
    expect(result.test_cases).toBeUndefined(); expect(result.grading_material).toBeUndefined()
    const replay = await (await request.post('/api/benchmark-runs', { headers: targetHeaders, data: create })).json()
    expect(replay.run.report_hash).toBe(original.report_hash)
    const files = (await readdir(stateDirectory)).filter((name) => name.endsWith('.json'))
    expect(files).toHaveLength(1)
    const journal = await readFile(join(stateDirectory, files[0]), 'utf8')
    for (const forbidden of ['PRIVATE_BROWSER', key, target.api_key, 'Two ordered values']) expect(journal).not.toContain(forbidden)
    expect((await stat(join(stateDirectory, files[0]))).mode & 0o777).toBe(0o600)
    const profile = await (await request.get(`/api/agents/${target.id}`)).json()
    expect(profile.benchmark_score).toBeNull()
    expect(profile.benchmark_evidence.measured_quality_score).toBeNull()
    expect((await (await request.get(`/api/agents/list?verified=true&search=${encodeURIComponent(target.name)}`)).json()).agents).toEqual([])
    await page.goto('/docs')
    await expect(page.getByText(/Versioned benchmarks are separate from peer scores/)).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  } finally { await rm(stateDirectory, { recursive: true, force: true }) }
})
