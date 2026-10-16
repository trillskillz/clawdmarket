import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { eq } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
import { reviewedContractFixture } from '../helpers/reviewed-contract-fixture'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let domain: typeof import('@/lib/organization-contract-authorizations')
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-contract-review-races-'))
  const key = `0x${'99'.repeat(32)}` as const
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'races.db')}`, TURSO_AUTH_TOKEN: '',
    JWT_SECRET: 'contract-review-races-fixture-only', AGENT_API_KEY_PEPPER: 'contract-review-races-fixture-only',
    CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true', TREASURY_ADDRESS: privateKeyToAccount(key).address,
    EVM_SETTLEMENT_PRIVATE_KEY: key, EVM_ACCEPTED_TOKENS: JSON.stringify([{ chainId: 8453, address: `0x${'44'.repeat(20)}`,
      symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, rpcUrl: 'http://127.0.0.1:1' }]),
  })
  delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED; delete process.env.DEV_WALLET_ADDRESS; delete process.env.DEV_FEE_WALLET_ADDRESS
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  domain = await import('@/lib/organization-contract-authorizations')
})
after(async () => { db?.$client.close(); if (directory) await rm(directory, { recursive: true, force: true }) })
async function waitFor(path: string, child: ReturnType<typeof spawn>, errors: () => string) {
  const deadline = Date.now() + 15000
  while (true) {
    try { await readFile(path); return } catch {
      assert.equal(child.exitCode, null, errors())
      assert.ok(Date.now() < deadline, `Contract boundary timeout: ${errors()}`)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
}
const childCode = `(async()=>{
  const a=JSON.parse(process.argv[1]),fs=await import('node:fs/promises');
  if(!process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-contract-review-races-'))throw Error('Disposable fixture required');
  const {db}=await import('./lib/db.ts'),s=await import('./lib/schema.ts'),{eq}=await import('drizzle-orm');
  const stop=async()=>{await fs.writeFile(a.marker,'ready');await new Promise(()=>{setInterval(()=>{},1000)})};
  if(a.boundary==='before'){
    const proto=Object.getPrototypeOf(db.session),transaction=proto.transaction;
    proto.transaction=function(fn,config){return transaction.call(this,async tx=>{const result=await fn(tx);
      const [row]=await tx.select().from(s.organization_contract_authorizations).where(eq(s.organization_contract_authorizations.contract_id,a.contractId));
      if(row && (a.operation==='propose'||row.state===(a.operation==='approve'?'approved':'revoked')))await stop();return result},config)}
  }
  if(a.barrier){await fs.writeFile(a.barrier+'.ready','');while(true){try{await fs.readFile(a.barrier+'.go');break}catch{await new Promise(r=>setTimeout(r,10))}}}
  const d=await import('./lib/organization-contract-authorizations.ts');let result;
  try{
    if(a.operation==='propose')result=await d.proposeOrganizationContract(a.org,a.actor,d.organizationContractInput.parse(a.body));
    else if(a.operation==='approve')result=await d.approveOrganizationContract(a.org,a.id,a.actor,d.organizationContractDecision.parse(a.body));
    else result=await d.revokeOrganizationContract(a.org,a.id,a.actor);
    if(a.boundary==='after')await stop();
    process.stdout.write(JSON.stringify({id:result.authorization.id,state:result.authorization.state,idempotent:result.idempotent}));
  }catch(error){if(error.code)process.stdout.write(JSON.stringify({error_code:error.code}));else throw error}
  db.$client.close()
})().catch(error=>{console.error(error);process.exitCode=1})`
function worker(command: Record<string, unknown>) {
  const child = spawn(process.execPath, ['--conditions=react-server', '--import', 'tsx', '-e', childCode, JSON.stringify(command)], {
    cwd: process.cwd(), env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let errors = '', output = ''; child.stderr!.on('data', chunk => errors += chunk); child.stdout!.on('data', chunk => output += chunk)
  const result = new Promise<any>((resolve, reject) => {
    child.on('error', reject); child.on('exit', (code, signal) => {
      if (code !== 0 || signal) reject(new Error(`Contract process ${signal ?? code}: ${errors}`))
      else { try { resolve(JSON.parse(output)) } catch (error) { reject(error) } }
    })
  })
  void result.catch(() => {})
  return { child, result, errors: () => errors }
}
const savedDecision = (a: { authority_hash: string }) => ({ version: 1 as const, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash, approve: true as const })

for (const changed of [false, true]) test(`separate contract proposal processes ${changed ? 'reject competing references for one draft' : 'recover one exact original reference'}`, async () => {
  const f = await reviewedContractFixture({ db, schema }), barriers = [join(directory, crypto.randomUUID()), join(directory, crypto.randomUUID())]
  const children = [f.input, changed ? { ...f.input, client_reference: crypto.randomUUID() } : f.input]
    .map((body, i) => worker({ operation: 'propose', org: f.org, actor: f.owner, contractId: f.original.contract.id, body, barrier: barriers[i] }))
  try {
    await Promise.all(children.map((c, i) => waitFor(`${barriers[i]}.ready`, c.child, c.errors)))
    await Promise.all(barriers.map(path => writeFile(`${path}.go`, '')))
    const results = await Promise.all(children.map(c => c.result))
    assert.equal(results.filter(r => r.id && !r.idempotent).length, 1, JSON.stringify(results))
    if (changed) assert.equal(results.filter(r => r.error_code === 'ORGANIZATION_CONTRACT_REVIEW_EXISTS').length, 1, JSON.stringify(results))
    else assert.equal(results.filter(r => r.idempotent).length, 1, JSON.stringify(results))
    assert.equal((await db.select().from(schema.organization_contract_authorizations).where(eq(schema.organization_contract_authorizations.contract_id, f.original.contract.id))).length, 1)
    assert.equal((await db.select().from(schema.contract_milestones).where(eq(schema.contract_milestones.contract_id, f.original.contract.id))).length, 2)
  } finally { for (const c of children) if (c.child.exitCode === null) c.child.kill('SIGKILL') }
})
for (const operation of ['propose', 'approve', 'revoke'] as const) for (const boundary of ['before', 'after'] as const) {
  test(`contract ${operation} survives actual ${boundary}-commit SIGKILL with original review identity and no credit authority`, async () => {
    const f = await reviewedContractFixture({ db, schema })
    const a = operation === 'propose' ? null : (await domain.proposeOrganizationContract(f.org, f.owner, domain.organizationContractInput.parse(f.input))).authorization
    const decision = a ? savedDecision(a) : null
    if (operation === 'revoke') await domain.approveOrganizationContract(f.org, a!.id, f.reviewer, decision!)
    const marker = join(directory, crypto.randomUUID()), running = worker({ operation, boundary, marker, org: f.org,
      id: a?.id, actor: operation === 'approve' ? f.reviewer : f.owner, contractId: f.original.contract.id,
      body: operation === 'propose' ? f.input : decision })
    const exited = new Promise<void>(resolve => running.child.once('exit', () => resolve()))
    try {
      await waitFor(marker, running.child, running.errors); running.child.kill('SIGKILL'); await exited
      assert.equal(running.child.signalCode, 'SIGKILL')
      const rows = await db.select().from(schema.organization_contract_authorizations).where(eq(schema.organization_contract_authorizations.contract_id, f.original.contract.id))
      if (operation === 'propose') assert.equal(rows.length, boundary === 'before' ? 0 : 1)
      else assert.equal(rows[0].state, operation === 'approve' ? boundary === 'before' ? 'pending' : 'approved' : boundary === 'before' ? 'approved' : 'revoked')
      const recovered = await domain.proposeOrganizationContract(f.org, f.owner, domain.organizationContractInput.parse(f.input))
      if (rows.length) assert.equal(recovered.authorization.id, rows[0].id)
      const approved = await domain.approveOrganizationContract(f.org, recovered.authorization.id, f.reviewer, decision ?? savedDecision(recovered.authorization))
      if (operation === 'revoke' && boundary === 'after') assert.equal(approved.authorization.state, 'revoked')
      assert.equal(approved.authorization.funding_available, false)
      await assert.rejects(domain.genericContractFundingGuard(db, f.original.contract.id), (error: unknown) => (error as { code: string }).code === 'CONTRACT_REVIEWED_FUNDING_REQUIRED')
      assert.equal((await db.select().from(schema.contracts).where(eq(schema.contracts.id, f.original.contract.id)))[0].state, 'DRAFT')
      assert.equal(Number((await db.$client.execute('SELECT COUNT(*) AS n FROM credit_entries')).rows[0].n), 0)
    } finally { if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGKILL'); await exited }
  })
}
