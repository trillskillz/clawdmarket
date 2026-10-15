import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { createWalletClient, erc20Abi, http } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
import { reviewedContractFixture } from '../helpers/reviewed-contract-fixture'
import { startDisposableWorkflowChain } from '../helpers/disposable-workflow-chain'
import { canonicalContract } from '@/lib/structured-verification'
import { creditDepositMessage } from '@/lib/credit-proof'
import { NextRequest } from 'next/server'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ClawdMarketClient, ClawdMarketTransportError } from '../../sdk/typescript/src/index'
import { reviewedSharedService } from '../helpers/reviewed-shared-service'
import { reviewedSharedTask } from '../helpers/reviewed-shared-task'

const enabled = Boolean(process.env.CLAWDMARKET_TEST_ANVIL_BINARY)
const payer = privateKeyToAccount(`0x${'18'.repeat(32)}`), treasuryKey = `0x${'99'.repeat(32)}` as const
let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let chain: Awaited<ReturnType<typeof startDisposableWorkflowChain>>, wallet: ReturnType<typeof createWalletClient>
let domain: typeof import('@/lib/organization-contract-authorizations'), reader: typeof import('@/lib/organization-contract-uses')
const digest = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
before(async () => {
  if (!enabled) return
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-contract-original-uses-'))
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'uses.db')}`, TURSO_AUTH_TOKEN: '', JWT_SECRET: 'contract-original-uses-fixture-only',
    AGENT_API_KEY_PEPPER: 'contract-original-uses-fixture-only', WEBHOOK_SECRET_KEY: 'contract-original-uses-fixture-only',
    CHAT_ENCRYPTION_KEY: 'contract-original-uses-fixture-only', CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true' })
  for (const name of ['VERCEL', 'VERCEL_ENV', 'CLAWDMARKET_NEW_PAYMENTS_PAUSED', 'DEV_WALLET_ADDRESS', 'DEV_FEE_WALLET_ADDRESS']) delete process.env[name]
  chain = await startDisposableWorkflowChain(process.env.CLAWDMARKET_TEST_ANVIL_BINARY!, payer.address, treasuryKey, 8453)
  Object.assign(process.env, { TREASURY_ADDRESS: chain.treasury, EVM_SETTLEMENT_PRIVATE_KEY: treasuryKey,
    EVM_ACCEPTED_TOKENS: JSON.stringify([{ chainId: 8453, address: chain.token, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 1, rpcUrl: chain.url }]) })
  wallet = createWalletClient({ chain: { ...mainnet, id: 8453 }, transport: http(chain.url), account: payer })
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  await db.$client.executeMultiple(await readFile('migrations/2026-10-15-contract-original-submissions-v1.sql', 'utf8'))
  await db.$client.executeMultiple(await readFile('migrations/2026-10-15-contract-exact-acceptance-v1.sql', 'utf8'))
  await db.$client.executeMultiple(await readFile('migrations/2026-10-15-contract-original-credit-release-v1.sql', 'utf8'))
  await db.$client.executeMultiple(await readFile('migrations/2026-10-15-contract-original-adjudication-v1.sql', 'utf8'))
  await db.$client.executeMultiple(await readFile('migrations/2026-10-15-contract-original-funding-reference-v1.sql', 'utf8'))
  domain = await import('@/lib/organization-contract-authorizations'); reader = await import('@/lib/organization-contract-uses')
})
after(async () => { db?.$client.close(); if (chain) await chain.stop(); if (directory) await rm(directory, { recursive: true, force: true }) })

async function fixture(withFundingReference = false) {
  const f = await reviewedContractFixture({ db, schema }), credit = await import('@/lib/account-credit')
  const deposit = await credit.createDeposit(f.buyer, { amount_minor: 105, payer: payer.address, client_reference: crypto.randomUUID() })
  await alignDisposableDepositClock(deposit.id)
  const hash = await wallet.writeContract({ account: payer, chain: { ...mainnet, id: 8453 }, address: chain.token, abi: erc20Abi,
    functionName: 'transfer', args: [chain.treasury, 1_050_000n] })
  await chain.client.waitForTransactionReceipt({ hash })
  await credit.confirmDeposit(f.buyer, { id: deposit.id, tx_hash: hash, signature: await payer.signMessage({ message: creditDepositMessage(deposit, hash) }) })
  const a = (await domain.proposeOrganizationContract(f.org, f.owner, domain.organizationContractInput.parse(f.input))).authorization
  await domain.approveOrganizationContract(f.org, a.id, f.reviewer, { version: 1, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash, approve: true })
  const feeRecipient = `fee-${crypto.randomUUID()}`
  await db.insert(schema.users).values({ id: feeRecipient, name: 'Original platform fee fixture', email: `${feeRecipient}@test.invalid`, password_hash: 'unused' })
  const now = new Date(Math.floor(Date.now() / 1000) * 1000), funding = { version: 1, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash }
  // Stored-record control only: the public reviewed funding API does not exist.
  // Real deposit collateral above prevents unbacked seeded credit substituting
  // for asset evidence. These direct test writes do not demonstrate a checkout.
  await db.transaction(async tx => {
    await tx.update(schema.contracts).set({ state: 'FUNDED', funded_at: now }).where(eq(schema.contracts.id, f.original.contract.id))
    await (await import('@/lib/organization-budgets')).attributeOrganizationContract(tx, f.buyerAgent, f.original.contract.id, 105, now)
    await credit.reserveCredit(tx, { id: f.original.contract.id, buyer: f.buyer, feeRecipient, total: 105, seller: 100, fee: 5 })
    await tx.insert(schema.organization_contract_uses).values({ authorization_id: a.id, contract_id: f.original.contract.id,
      fee_recipient_id: feeRecipient, authority_hash: a.authority_hash, client_reference: funding.client_reference,
      request_hash: digest(funding), amount_minor: 105, created_at: now })
    if (withFundingReference) await (await import('@/lib/contract-original-funding-reference')).recordOriginalContractFundingCommand(
      tx, f.org, a.id, f.buyer, f.original.contract.id, funding)
  })
  return { ...f, a, feeRecipient, funding }
}
const invalid = (error: unknown) => (error as { code?: string }).code === 'ORGANIZATION_CONTRACT_USE_INVALID'

/** Advance only this unforked test node BEFORE transferring. Never backdate the intent or relax the production proof guard. */
async function alignDisposableDepositClock(id: string) {
  const [intent] = await db.select().from(schema.credit_deposits).where(eq(schema.credit_deposits.id, id))
  const latest = await chain.rpc('eth_getBlockByNumber', ['latest', false])
  await chain.rpc('evm_setNextBlockTimestamp', [Math.max(Math.floor(Date.now() / 1000) + 1,
    Math.floor(intent.created_at.getTime() / 1000) + 1, Number(BigInt(latest.timestamp)) + 1)])
}

test('original contract use validates exact real-deposit-backed reservation and charges gross once without any chain fee unit', { skip: !enabled }, async () => {
  const f = await fixture(), original = await reader.originalReviewedContractUse(db, f.original.contract.id)
  assert.equal(original?.remaining_principal_minor, 100)
  assert.equal(original?.use.fee_recipient_id, f.feeRecipient)
  assert.deepEqual(await reader.organizationContractExposure(db, f.org, f.buyer), { daily: 105, monthly: 105, lifetime: 105, gas: 0n, fees: 0n })
  assert.deepEqual(await reader.reviewedOrganizationCreditGross(db, f.org, f.buyer), { daily: 105, monthly: 105, lifetime: 105 })
  assert.deepEqual(await reader.organizationContractExposure(db, f.org, f.buyer, f.original.contract.id), { daily: 0, monthly: 0, lifetime: 0, gas: 0n, fees: 0n })
  assert.equal((await db.select().from(schema.trades)).length, 0, 'no marketplace financial identity is fabricated')
})
test('historical refund retains original gross after owner, assignment, seller preference and review permission close', { skip: !enabled }, async () => {
  const f = await fixture()
  await domain.revokeOrganizationContract(f.org, f.a.id, f.owner)
  await db.update(schema.organizations).set({ owner_account_id: f.other }).where(eq(schema.organizations.id, f.org))
  await db.update(schema.organization_agent_assignments).set({ cost_center: 'CURRENT_CHANGED' }).where(eq(schema.organization_agent_assignments.agent_id, f.buyerAgent))
  await db.update(schema.seller_payment_preferences).set({ supported_rails: '[]' }).where(eq(schema.seller_payment_preferences.seller_id, f.seller))
  await db.transaction(async tx => {
    await (await import('@/lib/contract-settlement')).refundContractFunds(tx, { contractId: f.original.contract.id, buyerId: f.buyer, amount: 1 })
    await tx.update(schema.contracts).set({ state: 'CANCELED' }).where(eq(schema.contracts.id, f.original.contract.id))
  })
  assert.equal((await reader.originalReviewedContractUse(db, f.original.contract.id))?.remaining_principal_minor, 0)
  assert.equal((await reader.organizationContractExposure(db, f.org, f.buyer)).lifetime, 105)
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).available_minor, 100)
})
test('partial original milestone release and refund retain fee/principal conservation and original exposure', { skip: !enabled }, async () => {
  const f = await fixture(), settlement = await import('@/lib/contract-settlement')
  await db.transaction(async tx => {
    await settlement.releaseContractFunds(tx, { contractId: f.original.contract.id, milestoneId: f.original.milestones[0].id, buyerId: f.buyer, sellerId: f.seller, amount: .4 })
    await settlement.refundContractFunds(tx, { contractId: f.original.contract.id, milestoneId: f.original.milestones[1].id, buyerId: f.buyer, amount: .6 })
    await tx.update(schema.contracts).set({ state: 'COMPLETED' }).where(eq(schema.contracts.id, f.original.contract.id))
  })
  assert.equal((await reader.originalReviewedContractUse(db, f.original.contract.id))?.remaining_principal_minor, 0)
  assert.equal((await reader.organizationContractExposure(db, f.org, f.buyer)).lifetime, 105)
})
for (const mutation of ['request', 'amount', 'attribution', 'creation', 'purchase', 'fee-recipient', 'fee-amount', 'financial-family', 'orphan-sale']) {
  test(`original contract use fails closed on ${mutation} contradiction instead of adopting another financial reference`, { skip: !enabled }, async () => {
    const f = await fixture(), id = f.original.contract.id
    if (mutation === 'request') await db.update(schema.organization_contract_uses).set({ request_hash: '0'.repeat(64) }).where(eq(schema.organization_contract_uses.contract_id, id))
    if (mutation === 'amount') await db.update(schema.contract_milestones).set({ amount: .5 }).where(eq(schema.contract_milestones.id, f.original.milestones[0].id))
    if (mutation === 'attribution') await db.update(schema.organization_contract_attributions).set({ cost_center: 'CHANGED' }).where(eq(schema.organization_contract_attributions.contract_id, id))
    if (mutation === 'creation') await db.update(schema.contract_creation_requests).set({ request_hash: '0'.repeat(64) }).where(eq(schema.contract_creation_requests.contract_id, id))
    if (mutation === 'purchase') await db.update(schema.credit_entries).set({ available_delta: -100 }).where(eq(schema.credit_entries.reference, id))
    if (mutation === 'fee-recipient') await db.update(schema.organization_contract_uses).set({ fee_recipient_id: f.other }).where(eq(schema.organization_contract_uses.contract_id, id))
    if (mutation === 'fee-amount') await db.update(schema.credit_entries).set({ available_delta: 1 }).where(eq(schema.credit_entries.user_id, f.feeRecipient))
    if (mutation === 'financial-family') await db.insert(schema.trades).values({ id, listing_id: f.listing.id, buyer_id: f.buyer, seller_id: f.seller, amount: 1, fee: .05, payment_rail: 'credit', status: 'cancelled' })
    if (mutation === 'orphan-sale') await db.insert(schema.credit_entries).values({ user_id: f.seller, reference: id, kind: `contract_sale:${f.original.milestones[0].id}`, available_delta: 40, escrow_delta: 0 })
    await assert.rejects(reader.originalReviewedContractUse(db, id), invalid)
    await assert.rejects(reader.organizationContractExposure(db, f.org, f.buyer), invalid)
  })
}
test('funded companion without its original use cannot silently disappear from gross history', { skip: !enabled }, async () => {
  const f = await fixture()
  await db.delete(schema.organization_contract_uses).where(eq(schema.organization_contract_uses.contract_id, f.original.contract.id))
  await assert.rejects(reader.originalReviewedContractUse(db, f.original.contract.id), invalid)
  await assert.rejects(reader.organizationContractExposure(db, f.org, f.buyer), invalid)
})
test('an old reservation cannot be reclassified as a new reviewed draft by resetting its state', { skip: !enabled }, async () => {
  const f = await reviewedContractFixture({ db, schema })
  // Corrupted legacy-state negative control only; no account credit or economic
  // success is fabricated. A reservation row must close new review admission.
  await db.insert(schema.credit_entries).values({ user_id: f.buyer, reference: f.original.contract.id,
    kind: 'purchase', available_delta: -105, escrow_delta: 100 })
  await assert.rejects(domain.proposeOrganizationContract(f.org, f.owner, domain.organizationContractInput.parse(f.input)),
    (error: unknown) => (error as { code?: string }).code === 'ORGANIZATION_CONTRACT_DRAFT_REQUIRED')
  assert.equal((await db.select().from(schema.organization_contract_authorizations).where(eq(schema.organization_contract_authorizations.contract_id, f.original.contract.id))).length, 0)
})
test('original credit gross blocks new reviewed route, workflow, task, listing and contract budgets without consuming chain fee headroom', { skip: !enabled }, async () => {
  const f = await fixture(), { generateJWT } = await import('@/lib/auth')
  // Only unpaid external reservations are tested here. The actual node remains
  // Base-ID8453; no L1 transaction or fee proof is fabricated or submitted.
  Object.assign(process.env, { CLAWDMARKET_REUSABLE_SERVICES_ENABLED: 'true', CLAWDMARKET_ROUTE_PLANNING_ENABLED: 'true',
    CLAWDMARKET_ROUTE_EXECUTION_ENABLED: 'true', CLAWDMARKET_WORKFLOW_PLANNING_ENABLED: 'true', CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED: 'true',
    EVM_ACCEPTED_TOKENS: JSON.stringify([...JSON.parse(process.env.EVM_ACCEPTED_TOKENS!), { chainId: 1, address: chain.token,
      symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 1, rpcUrl: chain.url }]),
  })
  f.body.payment.token_address = chain.token
  await db.update(schema.seller_payment_preferences).set({ supported_rails: '["credit","evm"]' }).where(eq(schema.seller_payment_preferences.seller_id, f.seller))
  const request = (path: string, actor: string, body: unknown) => new NextRequest(`http://localhost${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${generateJWT({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })}` }, body: JSON.stringify(body),
  })
  for (const family of ['route', 'workflow'] as const) {
    const reserve = await reviewedSharedService({ db, schema }, request, f, family, '1.05', '1000000000000000')
    const result = await reserve()
    assert.equal(result.status, 409, JSON.stringify(result)); assert.equal(result.code, `ORGANIZATION_${family.toUpperCase()}_GROSS_LIMIT`)
  }
  const task = await reviewedSharedTask({ db, schema }, f, '1.05', '1000000000000000')
  const taskResult = await task(); assert.equal(taskResult.status, 409); assert.equal(taskResult.code, 'ORGANIZATION_TASK_DAILY_EXPOSURE')
  const listings = await import('@/lib/organization-listing-authorizations'), checkout = await import('@/lib/organization-listing-checkout')
  const a = (await listings.proposeOrganizationListing(f.org, f.owner, listings.organizationListingInput.parse({ ...f.body,
    client_reference: crypto.randomUUID(), max_daily: '1.05', max_monthly: '1.05', max_lifetime: '1.05' }))).authorization
  await listings.approveOrganizationListing(f.org, a.id, f.reviewer, { version: 1, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash, approve: true })
  await assert.rejects(checkout.checkoutOrganizationListing(f.org, a.id, f.buyer, { version: 1, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash }),
    (error: unknown) => (error as { code: string }).code === 'ORGANIZATION_LISTING_DAILY_EXPOSURE')
  const second = await (await import('@/lib/contract-creation')).createContractDraft(f.buyer,
    (await import('@/lib/validation')).createContractSchema.parse({ client_reference: crypto.randomUUID(), seller_id: f.seller, milestones: [{ title: 'Separate finite contract', amount: 1 }] }))
  const b = (await domain.proposeOrganizationContract(f.org, f.owner, domain.organizationContractInput.parse({ ...f.input,
    contract_id: second.contract.id, client_reference: crypto.randomUUID(), max_daily: '1.05', max_monthly: '1.05', max_lifetime: '1.05' }))).authorization
  const [row] = await db.select().from(schema.organization_contract_authorizations).where(eq(schema.organization_contract_authorizations.id, b.id))
  await assert.rejects(reader.assertReviewedContractGross(db, row), (error: unknown) => (error as { code: string }).code === 'ORGANIZATION_CONTRACT_DAILY_EXPOSURE')
  await assert.rejects(reader.assertReviewedContractGross(db, row, f.original.contract.id), invalid, 'another contract cannot be excluded from a funding budget')
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer))).length, 0)
  assert.deepEqual(await reader.reviewedOrganizationCreditGross(db, f.org, f.buyer), { daily: 105, monthly: 105, lifetime: 105 })
  assert.deepEqual(await reader.organizationContractExposure(db, f.org, f.buyer), { daily: 105, monthly: 105, lifetime: 105, gas: 0n, fees: 0n })
})
test('prior original route, workflow, task and listing gross blocks a fresh credit contract ceiling in the reverse reservation order', { skip: !enabled }, async () => {
  const { generateJWT } = await import('@/lib/auth')
  Object.assign(process.env, { CLAWDMARKET_REUSABLE_SERVICES_ENABLED: 'true', CLAWDMARKET_ROUTE_PLANNING_ENABLED: 'true', CLAWDMARKET_ROUTE_EXECUTION_ENABLED: 'true',
    CLAWDMARKET_WORKFLOW_PLANNING_ENABLED: 'true', CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED: 'true',
    EVM_ACCEPTED_TOKENS: JSON.stringify([...JSON.parse(process.env.EVM_ACCEPTED_TOKENS!).filter((t: { chainId: number }) => t.chainId !== 1),
      { chainId: 1, address: chain.token, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 1, rpcUrl: chain.url }]),
  })
  const request = (path: string, actor: string, body: unknown) => new NextRequest(`http://localhost${path}`, { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${generateJWT({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })}` }, body: JSON.stringify(body) })
  for (const family of ['route', 'workflow', 'task', 'listing'] as const) {
    const f = await reviewedContractFixture({ db, schema }); f.body.payment.token_address = chain.token
    await db.update(schema.seller_payment_preferences).set({ supported_rails: '["credit","evm"]' }).where(eq(schema.seller_payment_preferences.seller_id, f.seller))
    if (family === 'route' || family === 'workflow') {
      const reserve = await reviewedSharedService({ db, schema }, request, f, family, '1.05', '1000000000000000')
      const response = await reserve(); assert.equal(response.status, 201, JSON.stringify(response))
    } else if (family === 'task') {
      const reserve = await reviewedSharedTask({ db, schema }, f, '1.05', '1000000000000000')
      assert.equal((await reserve()).status, 201)
    } else {
      const listings = await import('@/lib/organization-listing-authorizations'), checkout = await import('@/lib/organization-listing-checkout')
      const a = (await listings.proposeOrganizationListing(f.org, f.owner, listings.organizationListingInput.parse(f.body))).authorization
      await listings.approveOrganizationListing(f.org, a.id, f.reviewer, { version: 1, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash, approve: true })
      assert.equal((await checkout.checkoutOrganizationListing(f.org, a.id, f.buyer, { version: 1, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash })).created, true)
    }
    const a = (await domain.proposeOrganizationContract(f.org, f.owner, domain.organizationContractInput.parse({ ...f.input,
      max_daily: '1.05', max_monthly: '1.05', max_lifetime: '1.05' }))).authorization
    const [row] = await db.select().from(schema.organization_contract_authorizations).where(eq(schema.organization_contract_authorizations.id, a.id))
    assert.deepEqual(await reader.reviewedOrganizationCreditGross(db, f.org, f.buyer), { daily: 105, monthly: 105, lifetime: 105 }, family)
    await assert.rejects(reader.assertReviewedContractGross(db, row), (error: unknown) => (error as { code: string }).code === 'ORGANIZATION_CONTRACT_DAILY_EXPOSURE')
    const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer))
    await db.update(schema.trades).set({ status: 'cancelled' }).where(eq(schema.trades.id, trade.id))
    assert.equal((await reader.reviewedOrganizationCreditGross(db, f.org, f.buyer)).lifetime, 105, 'cancellation cannot recycle original gross')
    assert.equal((await db.select().from(schema.credit_entries).where(eq(schema.credit_entries.user_id, f.buyer))).length, 0, 'this is an unpaid reservation control, not funded credit')
  }
})
async function startOriginal(f: Pick<Awaited<ReturnType<typeof fixture>>, 'seller' | 'original'>) {
  const { generateJWT } = await import('@/lib/auth'), { PATCH } = await import('@/app/api/contracts/[id]/route')
  const response = await PATCH(new NextRequest(`http://localhost/api/contracts/${f.original.contract.id}`, { method: 'PATCH', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${generateJWT({ userId: f.seller, email: `${f.seller}@test.invalid`, role: 'human' })}` }, body: JSON.stringify({ action: 'start' }) }),
  { params: Promise.resolve({ id: f.original.contract.id }) })
  assert.equal(response.status, 200)
}
test('internal original seller submission replays one immutable output and finite report without accepting or moving credit', { skip: !enabled }, async () => {
  const f = await fixture(); await startOriginal(f)
  const { submitOriginalReviewedContract: submit } = await import('@/lib/contract-original-submissions')
  const input = { version: 1 as const, client_reference: crypto.randomUUID(), artifact_bundle: { report: 'Original finite output' } }
  const replies = await Promise.all([submit(f.original.contract.id, f.original.milestones[0].id, f.seller, input), submit(f.original.contract.id, f.original.milestones[0].id, f.seller, input)])
  assert.equal(replies.filter(r => r.idempotent).length, 1); assert.equal(replies[0].submission.id, replies[1].submission.id)
  const original = replies[0]
  assert.equal(original.submission.auto_check_result, 'pass'); assert.equal(original.submission.authorizes_payment, false)
  assert.equal(original.submission.semantic_accuracy, 'unmeasured'); assert.equal(original.submission.remote_execution_observed, false)
  assert.equal(original.credit_remaining_principal_minor, 100); assert.equal(original.milestone_state, 'AWAITING_BUYER_REVIEW')
  const { generateJWT } = await import('@/lib/auth'), milestoneApi = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/route')
  const originalPath = `/api/contracts/${f.original.contract.id}/milestones/${f.original.milestones[0].id}`
  const milestoneContext = { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[0].id }) }
  for (const actor of [f.buyer, f.seller, f.owner, f.reviewer, f.other]) {
    const response = await milestoneApi.GET(new NextRequest(`http://localhost${originalPath}`, { headers: {
      Authorization: `Bearer ${generateJWT({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })}` } }), milestoneContext)
    if (actor === f.buyer || actor === f.seller) {
      assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
      const inspected = await response.json(); assert.equal(inspected.submission.content_hash, original.submission.content_hash)
      assert.equal(inspected.submission.artifact_bundle.report, input.artifact_bundle.report); assert.ok(Date.parse(inspected.observed_at))
    } else { assert.equal(response.status, 404); assert.equal(JSON.stringify(await response.json()).includes(input.artifact_bundle.report), false) }
  }
  const { createNamedAgentCredential } = await import('@/lib/agent-named-credentials')
  const read = await createNamedAgentCredential({ agentId: f.buyerAgent, name: 'Original submission read', scopes: ['agent:read'], actorCredentialId: null })
  assert.equal(read.kind, 'created'); if (read.kind !== 'created') throw new Error('Read fixture failed')
  assert.equal((await milestoneApi.GET(new NextRequest(`http://localhost${originalPath}`, { headers: { 'X-ClawdMarket-Agent-Key': read.api_key } }), milestoneContext)).status, 200)
  assert.equal((await milestoneApi.PATCH(new NextRequest(`http://localhost${originalPath}`, { method: 'PATCH', headers: { 'X-ClawdMarket-Agent-Key': read.api_key,
    'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) }), milestoneContext)).status, 401)
  for (const [action, actor] of [['submit', f.seller], ['mark_paid', f.buyer]]) {
    const path = `/api/contracts/${f.original.contract.id}/milestones/${f.original.milestones[0].id}`
    const response = await milestoneApi.PATCH(new NextRequest(`http://localhost${path}`, { method: 'PATCH', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${generateJWT({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })}` }, body: JSON.stringify({ action }) }),
    { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[0].id }) })
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'CONTRACT_REVIEWED_FULFILLMENT_UNAVAILABLE')
  }
  await assert.rejects(submit(f.original.contract.id, f.original.milestones[0].id, f.buyer, input), (error: unknown) => (error as { code: string }).code === 'CONTRACT_SUBMISSION_SELLER_REQUIRED')
  await assert.rejects(submit(f.original.contract.id, f.original.milestones[1].id, f.seller, input), (error: unknown) => (error as { code: string }).code === 'CONTRACT_SUBMISSION_REFERENCE_CONFLICT')
  await assert.rejects(submit(f.original.contract.id, f.original.milestones[0].id, f.seller, { ...input, artifact_bundle: { report: 'Changed output' } }),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_SUBMISSION_REFERENCE_CONFLICT')
  for (const statement of [
    'UPDATE contract_submissions SET artifact_bundle=\'{}\' WHERE id=?', 'DELETE FROM contract_submissions WHERE id=?',
    'UPDATE contract_submission_operations SET content_hash=\'changed\' WHERE submission_id=?', 'DELETE FROM contract_submission_operations WHERE submission_id=?',
  ]) await assert.rejects(db.$client.execute({ sql: statement, args: [original.submission.id] }), /immutable/)
  await domain.revokeOrganizationContract(f.org, f.a.id, f.owner)
  await db.update(schema.contract_milestones).set({ state: 'CHANGES_REQUESTED', acceptance_spec: '{"required_artifacts":["MUTATED_CATALOG_KEY"]}' })
    .where(eq(schema.contract_milestones.id, f.original.milestones[0].id))
  const next = await submit(f.original.contract.id, f.original.milestones[0].id, f.seller, { ...input, client_reference: crypto.randomUUID(), artifact_bundle: { report: 'Second original operation' } })
  assert.notEqual(next.submission.id, original.submission.id); assert.equal(next.submission.auto_check_result, 'pass', 'paid original frozen requirements govern delivery')
  const replay = await submit(f.original.contract.id, f.original.milestones[0].id, f.seller, input)
  assert.equal(replay.submission.id, original.submission.id); assert.equal(replay.superseded, true); assert.equal(replay.selected_submission_id, next.submission.id)
  const recovered = await milestoneApi.GET(new NextRequest(`http://localhost${originalPath}?client_reference=${input.client_reference}`, { headers: {
    Authorization: `Bearer ${generateJWT({ userId: f.buyer, email: `${f.buyer}@test.invalid`, role: 'human' })}` } }), milestoneContext)
  assert.equal(recovered.status, 200); const recoveredBody = await recovered.json()
  assert.equal(recoveredBody.submission.id, original.submission.id); assert.equal(recoveredBody.superseded, true)
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).escrow_minor, 100)
})
test('missing finite keys and unbounded original submission data cannot create acceptance or output records', { skip: !enabled }, async () => {
  const f = await fixture(); await startOriginal(f)
  const { submitOriginalReviewedContract: submit } = await import('@/lib/contract-original-submissions')
  const input = { version: 1 as const, client_reference: crypto.randomUUID(), artifact_bundle: {} }
  const failed = await submit(f.original.contract.id, f.original.milestones[0].id, f.seller, input)
  assert.equal(failed.submission.auto_check_result, 'fail'); assert.equal(failed.milestone_state, 'AUTO_FAILED')
  assert.equal(failed.submission.authorizes_payment, false)
  await assert.rejects((await import('@/lib/contract-exact-acceptance')).acceptOriginalReviewedContract(f.original.contract.id,
    f.original.milestones[0].id, f.buyer, { version: 1, client_reference: crypto.randomUUID(), submission_id: failed.submission.id,
      content_hash: failed.submission.content_hash, approve: true }),
  (error: unknown) => (error as { code: string }).code === 'CONTRACT_ACCEPTANCE_STATE_CHANGED')
  await assert.rejects(submit(f.original.contract.id, f.original.milestones[0].id, f.seller,
    { ...input, client_reference: crypto.randomUUID(), artifact_bundle: { report: 'x'.repeat(65537) } }),
  (error: unknown) => (error as { code: string }).code === 'CONTRACT_SUBMISSION_INPUT_LIMIT')
  let nested: unknown = 1; for (let i = 0; i < 30; i++) nested = { nested }
  await assert.rejects(submit(f.original.contract.id, f.original.milestones[0].id, f.seller,
    { ...input, client_reference: crypto.randomUUID(), artifact_bundle: { report: nested } }),
  (error: unknown) => (error as { code: string }).code === 'CONTRACT_SUBMISSION_INPUT_LIMIT')
  assert.equal((await db.select().from(schema.contract_submissions).where(eq(schema.contract_submissions.milestone_id, f.original.milestones[0].id))).length, 1)
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).escrow_minor, 100)
})
test('internal exact buyer decisions persist once, require the selected immutable submission and cannot accept replacement output after redo', { skip: !enabled }, async () => {
  const f = await fixture(); await startOriginal(f)
  const { submitOriginalReviewedContract: submit } = await import('@/lib/contract-original-submissions')
  const { acceptOriginalReviewedContract: accept } = await import('@/lib/contract-exact-acceptance')
  const first = await submit(f.original.contract.id, f.original.milestones[0].id, f.seller, {
    version: 1, client_reference: crypto.randomUUID(), artifact_bundle: { report: 'Buyer must accept this exact original output' } })
  const input = { version: 1 as const, client_reference: crypto.randomUUID(), submission_id: first.submission.id, content_hash: first.submission.content_hash, approve: true as const }
  for (const actor of [f.owner, f.reviewer, f.seller, f.other]) await assert.rejects(accept(f.original.contract.id, f.original.milestones[0].id, actor, input),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_ACCEPTANCE_BUYER_REQUIRED')
  await assert.rejects(accept(f.original.contract.id, f.original.milestones[0].id, f.buyer, { ...input, content_hash: '0'.repeat(64) }),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_ACCEPTANCE_SUBMISSION_CHANGED')
  await assert.rejects(accept(f.original.contract.id, f.original.milestones[1].id, f.buyer, input),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_ACCEPTANCE_SUBMISSION_CHANGED')
  const replies = await Promise.all([accept(f.original.contract.id, f.original.milestones[0].id, f.buyer, input), accept(f.original.contract.id, f.original.milestones[0].id, f.buyer, input)])
  assert.equal(replies.filter(r => r.idempotent).length, 1); assert.equal(replies[0].decision.id, replies[1].decision.id)
  assert.equal(replies[0].current_milestone_state, 'APPROVED'); assert.equal(replies[0].financial_release_performed, false)
  assert.equal(replies[0].credit_remaining_principal_minor, 100)
  await assert.rejects(accept(f.original.contract.id, f.original.milestones[0].id, f.buyer, { ...input, client_reference: crypto.randomUUID() }),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_ACCEPTANCE_REFERENCE_CONFLICT')
  for (const sql of ['UPDATE contract_acceptance_operations SET content_hash=\'changed\' WHERE id=?', 'DELETE FROM contract_acceptance_operations WHERE id=?']) {
    await assert.rejects(db.$client.execute({ sql, args: [replies[0].decision.id] }), /immutable/)
  }
  // Redo-state control only; no admin ruling or completed public economic journey is claimed.
  await db.update(schema.contract_milestones).set({ state: 'ACTIVE' }).where(eq(schema.contract_milestones.id, f.original.milestones[0].id))
  const second = await submit(f.original.contract.id, f.original.milestones[0].id, f.seller, {
    version: 1, client_reference: crypto.randomUUID(), artifact_bundle: first.submission.artifact_bundle })
  assert.notEqual(second.submission.id, first.submission.id)
  assert.equal(second.submission.content_hash, first.submission.content_hash, 'identical output bytes after redo still need the new submission identity')
  const old = await accept(f.original.contract.id, f.original.milestones[0].id, f.buyer, input)
  assert.equal(old.decision.id, replies[0].decision.id); assert.equal(old.applies_to_current_submission, false)
  assert.equal(old.current_milestone_state, 'AWAITING_BUYER_REVIEW')
  const api = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/route'), { generateJWT: jwt } = await import('@/lib/auth')
  const context = { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[0].id }) }
  const path = `http://localhost/api/contracts/${f.original.contract.id}/milestones/${f.original.milestones[0].id}`
  const headers = { Authorization: `Bearer ${jwt({ userId: f.buyer, email: `${f.buyer}@test.invalid`, role: 'human' })}`, 'Content-Type': 'application/json' }
  const recovered = await api.GET(new NextRequest(`${path}?acceptance_reference=${input.client_reference}`, { headers }), context)
  assert.equal(recovered.status, 200); assert.equal((await recovered.json()).applies_to_current_submission, false)
  const replay = await api.PATCH(new NextRequest(path, { method: 'PATCH', headers, body: JSON.stringify({ ...input, action: 'approve' }) }), context)
  assert.equal(replay.status, 200); assert.equal((await replay.json()).current_milestone_state, 'AWAITING_BUYER_REVIEW')
  const fresh = await accept(f.original.contract.id, f.original.milestones[0].id, f.buyer, { ...input, client_reference: crypto.randomUUID(),
    submission_id: second.submission.id, content_hash: second.submission.content_hash })
  assert.notEqual(fresh.decision.id, old.decision.id); assert.equal(fresh.applies_to_current_submission, true)
  assert.equal((await db.select().from(schema.contract_acceptance_operations).where(eq(schema.contract_acceptance_operations.milestone_id, f.original.milestones[0].id))).length, 2)
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).escrow_minor, 100)
})

test('public exact acceptance enforces original buyer, scope, CSRF, finite checks and private unambiguous decision recovery without paying', { skip: !enabled }, async () => {
  const f = await fixture(); await startOriginal(f)
  const { submitOriginalReviewedContract: submit } = await import('@/lib/contract-original-submissions')
  const api = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/route'), { generateJWT: jwt } = await import('@/lib/auth')
  const first = await submit(f.original.contract.id, f.original.milestones[0].id, f.seller, {
    version: 1, client_reference: crypto.randomUUID(), artifact_bundle: { report: 'PRIVATE_API_ACCEPTANCE_OUTPUT' } })
  const input = { action: 'approve', version: 1, client_reference: crypto.randomUUID(), submission_id: first.submission.id, content_hash: first.submission.content_hash, approve: true }
  const path = `/api/contracts/${f.original.contract.id}/milestones/${f.original.milestones[0].id}`
  const context = { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[0].id }) }
  const token = (actor: string) => jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })
  const patch = (actor: string, body: unknown = input, headers?: Record<string, string>) => api.PATCH(new NextRequest(`http://localhost${path}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token(actor)}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }), context)
  assert.equal((await patch(f.buyer, { action: 'approve' })).status, 400, 'hashless reviewed approve cannot use legacy acceptance')
  assert.equal((await patch(f.buyer, { ...input, approve: 'x'.repeat(512 * 1024) })).status, 413)
  for (const actor of [f.seller, f.owner, f.reviewer, f.other]) assert.equal((await patch(actor)).status, 403)
  for (const body of [{ ...input, content_hash: '0'.repeat(64) }, { ...input, submission_id: crypto.randomUUID() }]) assert.equal((await patch(f.buyer, body)).status, 409)
  assert.equal((await patch(f.buyer, input, { Authorization: 'Bearer invalid', Cookie: `auth-token=${token(f.buyer)}` })).status, 403)
  const { createNamedAgentCredential } = await import('@/lib/agent-named-credentials')
  const read = await createNamedAgentCredential({ agentId: f.buyerAgent, name: 'Acceptance recovery only', scopes: ['agent:read'], actorCredentialId: null })
  assert.equal(read.kind, 'created'); if (read.kind !== 'created') throw new Error('Credential fixture failed')
  assert.equal((await patch(f.buyer, input, { Authorization: '', 'X-ClawdMarket-Agent-Key': read.api_key })).status, 401)
  const result = await patch(f.buyer)
  assert.equal(result.status, 201); assert.equal(result.headers.get('Cache-Control'), 'private, no-store')
  const accepted = await result.json(); assert.equal(accepted.financial_release_performed, false); assert.equal(accepted.credit_remaining_principal_minor, 100)
  assert.equal((await patch(f.buyer)).status, 200)
  assert.equal((await patch(f.buyer, { ...input, client_reference: crypto.randomUUID() })).status, 409)
  for (const actor of [f.buyer, f.seller, f.owner, f.reviewer, f.other]) {
    const read = await api.GET(new NextRequest(`http://localhost${path}?acceptance_reference=${input.client_reference}`, {
      headers: { Authorization: `Bearer ${token(actor)}` } }), context)
    assert.equal(read.headers.get('Cache-Control'), 'private, no-store')
    if ([f.buyer, f.seller].includes(actor)) {
      assert.equal(read.status, 200); const body = await read.json()
      assert.deepEqual(body.decision, accepted.decision); assert.equal(body.applies_to_current_submission, true); assert.ok(Date.parse(body.observed_at))
    } else { assert.equal(read.status, 404); assert.equal(JSON.stringify(await read.json()).includes('PRIVATE_API_ACCEPTANCE_OUTPUT'), false) }
  }
  assert.equal((await api.GET(new NextRequest(`http://localhost${path}?acceptance_reference=${input.client_reference}`, {
    headers: { 'X-ClawdMarket-Agent-Key': read.api_key } }), context)).status, 200)
  for (const query of [`acceptance_reference=${input.client_reference}&client_reference=${input.client_reference}`,
    `acceptance_reference=${input.client_reference}&acceptance_reference=${input.client_reference}`, 'acceptance_reference=short', 'acceptance_reference=unknown-reference']) {
    const response = await api.GET(new NextRequest(`http://localhost${path}?${query}`, { headers: { Authorization: `Bearer ${token(f.buyer)}` } }), context)
    assert.equal(response.status, query.includes('unknown-reference') ? 404 : 400)
  }
  assert.equal((await patch(f.buyer, { action: 'mark_paid' })).status, 409)
  // Exact command must never silently degrade to legacy hashless approval.
  const legacy = await reviewedContractFixture({ db, schema })
  const legacyResponse = await api.PATCH(new NextRequest(`http://localhost/api/contracts/${legacy.original.contract.id}/milestones/${legacy.original.milestones[0].id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token(legacy.buyer)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
  { params: Promise.resolve({ id: legacy.original.contract.id, milestoneId: legacy.original.milestones[0].id }) })
  assert.equal(legacyResponse.status, 409); assert.equal((await legacyResponse.json()).code, 'CONTRACT_REVIEWED_USE_REQUIRED')
  const failedFixture = await fixture(); await startOriginal(failedFixture)
  const failed = await submit(failedFixture.original.contract.id, failedFixture.original.milestones[0].id, failedFixture.seller, {
    version: 1, client_reference: crypto.randomUUID(), artifact_bundle: {} })
  const failedReply = await api.PATCH(new NextRequest(`http://localhost/api/contracts/${failedFixture.original.contract.id}/milestones/${failedFixture.original.milestones[0].id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token(failedFixture.buyer)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, client_reference: crypto.randomUUID(), submission_id: failed.submission.id, content_hash: failed.submission.content_hash }) }),
  { params: Promise.resolve({ id: failedFixture.original.contract.id, milestoneId: failedFixture.original.milestones[0].id }) })
  assert.equal(failedReply.status, 409); assert.equal((await failedReply.json()).code, 'CONTRACT_ACCEPTANCE_STATE_CHANGED')
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).escrow_minor, 100)
})

test('both SDKs recover genuinely lost committed acceptance HTTP replies after review closes without retrying or releasing credit', { skip: !enabled }, async () => {
  const api = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/route'), { generateJWT: jwt } = await import('@/lib/auth')
  for (const language of ['typescript', 'python']) {
    const f = await fixture(); await startOriginal(f)
    const first = await (await import('@/lib/contract-original-submissions')).submitOriginalReviewedContract(f.original.contract.id, f.original.milestones[0].id, f.seller, {
      version: 1, client_reference: crypto.randomUUID(), artifact_bundle: { report: 'Lost real decision reply' } })
    const input = { version: 1 as const, client_reference: crypto.randomUUID(), submission_id: first.submission.id, content_hash: first.submission.content_hash, approve: true as const }
    const token = jwt({ userId: f.buyer, email: `${f.buyer}@test.invalid`, role: 'human' })
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    let committed: any
    const server = createServer(async (incoming, outgoing) => {
      try {
        let body = ''; for await (const chunk of incoming) body += chunk
        calls.push({ method: incoming.method!, path: incoming.url!, body: body ? JSON.parse(body) : null })
        const request = new NextRequest(`http://localhost${incoming.url}`, { method: incoming.method, headers: {
          Authorization: incoming.headers.authorization!, 'Content-Type': 'application/json' }, ...(incoming.method === 'PATCH' ? { body } : {}) })
        const context = { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[0].id }) }
        const response = await (incoming.method === 'PATCH' ? api.PATCH(request, context) : api.GET(request, context))
        const result = await response.json()
        if (!committed && incoming.method === 'PATCH') {
          assert.equal(response.status, 201); committed = result
          await domain.revokeOrganizationContract(f.org, f.a.id, f.owner)
          outgoing.destroy() // Real TCP response loss, after the acceptance transaction commits.
        } else { outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(JSON.stringify(result)) }
      } catch (error) { outgoing.statusCode = 500; outgoing.end(JSON.stringify({ error: String(error) })) }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      let result: any
      if (language === 'typescript') {
        const client = new ClawdMarketClient({ apiKey: token, baseUrl: base })
        await assert.rejects(client.acceptOriginalContractSubmission(f.original.contract.id, f.original.milestones[0].id, input), ClawdMarketTransportError)
        assert.equal(calls.length, 1, 'uncertain mutation never retries automatically')
        const recovered = await client.recoverOriginalContractAcceptance(f.original.contract.id, f.original.milestones[0].id, input.client_reference)
        const replay = await client.acceptOriginalContractSubmission(f.original.contract.id, f.original.milestones[0].id, input)
        result = { recovered, replay }
      } else {
        const source = `import json, os
from clawdmarket import ClawdMarketClient, ClawdMarketTransportError
f = json.loads(os.environ['CLAWDMARKET_LOCAL_ACCEPTANCE_FIXTURE'])
c = ClawdMarketClient(f['token'], base_url=f['base'])
try:
    c.accept_original_contract_submission(f['contract'], f['milestone'], f['input'])
except ClawdMarketTransportError:
    pass
else:
    raise AssertionError('Expected lost committed HTTP reply')
r = c.recover_original_contract_acceptance(f['contract'], f['milestone'], f['input']['client_reference'])
p = c.accept_original_contract_submission(f['contract'], f['milestone'], f['input'])
print(json.dumps({'recovered': r, 'replay': p}))`
        const output = await promisify(execFile)('python3', ['-c', source], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: 'sdk/python',
          CLAWDMARKET_LOCAL_ACCEPTANCE_FIXTURE: JSON.stringify({ token, base, contract: f.original.contract.id, milestone: f.original.milestones[0].id, input }) }, timeout: 30000 })
        result = JSON.parse(output.stdout)
      }
      assert.deepEqual(calls.map(c => c.method), ['PATCH', 'GET', 'PATCH'])
      assert.deepEqual(calls[0].body, { ...input, action: 'approve' }); assert.deepEqual(calls[2].body, calls[0].body)
      assert.ok(calls[1].path.endsWith(`?acceptance_reference=${input.client_reference}`))
      assert.deepEqual(result.recovered.decision, committed.decision); assert.deepEqual(result.replay.decision, committed.decision)
      assert.equal(result.replay.idempotent, true); assert.equal(result.replay.financial_release_performed, false)
      assert.equal(result.recovered.credit_remaining_principal_minor, 100); assert.equal(result.replay.credit_remaining_principal_minor, 100)
      assert.equal((await db.select().from(schema.contract_acceptance_operations).where(eq(schema.contract_acceptance_operations.contract_id, f.original.contract.id))).length, 1)
      assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).escrow_minor, 100)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  }
})

async function acceptedMilestone(f: Awaited<ReturnType<typeof fixture>>, index = 0, artifacts = { report: 'Original paid work' }) {
  const submission = await (await import('@/lib/contract-original-submissions')).submitOriginalReviewedContract(f.original.contract.id,
    f.original.milestones[index].id, f.seller, { version: 1, client_reference: crypto.randomUUID(), artifact_bundle: artifacts })
  const acceptance = await (await import('@/lib/contract-exact-acceptance')).acceptOriginalReviewedContract(f.original.contract.id,
    f.original.milestones[index].id, f.buyer, { version: 1, client_reference: crypto.randomUUID(),
      submission_id: submission.submission.id, content_hash: submission.submission.content_hash, approve: true })
  return { submission, acceptance, input: { version: 1 as const, client_reference: crypto.randomUUID(),
    submission_id: submission.submission.id, content_hash: submission.submission.content_hash, acceptance_id: acceptance.decision.id } }
}
async function openDispute(f: Pick<Awaited<ReturnType<typeof fixture>>, 'buyer' | 'original'>) {
  const api = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/route'), { generateJWT: jwt } = await import('@/lib/auth')
  const response = await api.PATCH(new NextRequest(`http://localhost/api/contracts/${f.original.contract.id}/milestones/${f.original.milestones[0].id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt({ userId: f.buyer, email: `${f.buyer}@test.invalid`, role: 'human' })}` },
    body: JSON.stringify({ action: 'open_dispute', reason_code: 'disposable-controlled-dispute' }) }),
  { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[0].id }) })
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
  return (await response.json()).contract.dispute_id as string
}
async function adjudicate(f: Pick<Awaited<ReturnType<typeof fixture>>, 'owner'>, dispute: string, ruling: string, actor = f.owner) {
  const api = await import('@/app/api/admin/contracts/disputes/[id]/resolve/route'), { generateJWT: jwt } = await import('@/lib/auth')
  const old = process.env.ADMIN_USER_IDS; process.env.ADMIN_USER_IDS = f.owner
  try {
    return await api.PATCH(new NextRequest(`http://localhost/api/admin/contracts/disputes/${dispute}/resolve`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })}` },
      body: JSON.stringify({ ruling, ...(ruling === 'split' ? { split_percent_to_seller: 25 } : {}) }) }), { params: Promise.resolve({ id: dispute }) })
  } finally { if (old === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = old }
}

test('internal original credit release posts exact accepted milestones once, conserves original fees and recovers after completion and review closure', { skip: !enabled }, async () => {
  const f = await fixture(); await startOriginal(f)
  const { releaseOriginalContractCredit: release, inspectOriginalContractCreditRelease: inspect } = await import('@/lib/contract-original-credit-release')
  const first = await acceptedMilestone(f)
  for (const actor of [f.owner, f.reviewer, f.seller, f.other]) await assert.rejects(release(f.original.contract.id, f.original.milestones[0].id, actor, first.input),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_RELEASE_BUYER_REQUIRED')
  const results = await Promise.all([release(f.original.contract.id, f.original.milestones[0].id, f.buyer, first.input), release(f.original.contract.id, f.original.milestones[0].id, f.buyer, first.input)])
  assert.equal(results.filter(r => r.idempotent).length, 1); assert.equal(results[0].release.id, results[1].release.id)
  assert.equal(results[0].release.amount_minor, 40); assert.equal(results[0].financial_posting_confirmed, true)
  assert.equal(results[0].release.seller_receives, 'nonwithdrawable_account_credit'); assert.equal(results[0].credit_remaining_principal_minor, 60)
  const credit = await import('@/lib/account-credit')
  assert.equal((await credit.creditBalance(f.seller)).available_minor, 40); assert.equal((await credit.creditBalance(f.feeRecipient)).available_minor, 5)
  for (const statement of ['UPDATE contract_release_operations SET amount_minor=1 WHERE id=?', 'DELETE FROM contract_release_operations WHERE id=?']) {
    await assert.rejects(db.$client.execute({ sql: statement, args: [results[0].release.id] }), /immutable/)
  }
  await assert.rejects(release(f.original.contract.id, f.original.milestones[0].id, f.buyer, { ...first.input, client_reference: crypto.randomUUID() }),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_RELEASE_REFERENCE_CONFLICT')
  await assert.rejects(release(f.original.contract.id, f.original.milestones[0].id, f.buyer, { ...first.input, content_hash: '0'.repeat(64) }),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_RELEASE_REFERENCE_CONFLICT')
  await assert.rejects(release(f.original.contract.id, f.original.milestones[1].id, f.buyer, first.input),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_RELEASE_REFERENCE_CONFLICT')
  await domain.revokeOrganizationContract(f.org, f.a.id, f.owner)
  await db.update(schema.seller_payment_preferences).set({ supported_rails: '["evm"]' }).where(eq(schema.seller_payment_preferences.seller_id, f.seller))
  const second = await acceptedMilestone(f, 1)
  const final = await release(f.original.contract.id, f.original.milestones[1].id, f.buyer, second.input)
  assert.equal(final.credit_remaining_principal_minor, 0)
  assert.equal((await db.select().from(schema.contracts).where(eq(schema.contracts.id, f.original.contract.id)))[0].state, 'COMPLETED')
  assert.equal((await credit.creditBalance(f.seller)).available_minor, 100); assert.equal((await credit.creditBalance(f.buyer)).escrow_minor, 0)
  assert.equal((await credit.creditBalance(f.feeRecipient)).available_minor, 5)
  for (const actor of [f.buyer, f.seller]) {
    const recovered = await inspect(db, f.original.contract.id, f.original.milestones[0].id, actor, first.input.client_reference)
    assert.equal(recovered.release.id, results[0].release.id); assert.equal(recovered.financial_posting_confirmed, true); assert.equal(recovered.credit_remaining_principal_minor, 0)
  }
  for (const actor of [f.owner, f.reviewer, f.other]) await assert.rejects(inspect(db, f.original.contract.id, f.original.milestones[0].id, actor, first.input.client_reference),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_RELEASE_NOT_FOUND')
  assert.equal((await release(f.original.contract.id, f.original.milestones[0].id, f.buyer, first.input)).idempotent, true)
  assert.equal((await reader.organizationContractExposure(db, f.org, f.buyer)).lifetime, 105)
})

test('release requires real exact consent and actual ledger proof, and a failed journal append rolls back state and both credit postings', { skip: !enabled }, async () => {
  const f = await fixture(); await startOriginal(f)
  const { releaseOriginalContractCredit: release, inspectOriginalContractCreditRelease: inspect } = await import('@/lib/contract-original-credit-release')
  const output = await (await import('@/lib/contract-original-submissions')).submitOriginalReviewedContract(f.original.contract.id, f.original.milestones[0].id, f.seller,
    { version: 1, client_reference: crypto.randomUUID(), artifact_bundle: { report: 'Passing finite checks are insufficient for payment' } })
  const input = { version: 1, client_reference: crypto.randomUUID(), submission_id: output.submission.id, content_hash: output.submission.content_hash, acceptance_id: crypto.randomUUID() }
  await db.update(schema.contract_milestones).set({ state: 'APPROVED' }).where(eq(schema.contract_milestones.id, f.original.milestones[0].id))
  await assert.rejects(release(f.original.contract.id, f.original.milestones[0].id, f.buyer, input),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_RELEASE_EXACT_ACCEPTANCE_REQUIRED')
  await db.update(schema.contract_milestones).set({ state: 'PAID' }).where(eq(schema.contract_milestones.id, f.original.milestones[0].id))
  await assert.rejects(inspect(db, f.original.contract.id, f.original.milestones[0].id, f.buyer, input.client_reference),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_RELEASE_NOT_FOUND')
  await db.update(schema.contract_milestones).set({ state: 'AWAITING_BUYER_REVIEW' }).where(eq(schema.contract_milestones.id, f.original.milestones[0].id))
  const { acceptance_id: _id, ...command } = input
  const acceptance = await (await import('@/lib/contract-exact-acceptance')).acceptOriginalReviewedContract(f.original.contract.id, f.original.milestones[0].id, f.buyer, { ...command, approve: true })
  const exact = { ...input, acceptance_id: acceptance.decision.id }
  await db.$client.execute("CREATE TRIGGER injected_release_append_failure BEFORE INSERT ON contract_release_operations BEGIN SELECT RAISE(ABORT, 'injected_release_append_failure'); END")
  try { await assert.rejects(release(f.original.contract.id, f.original.milestones[0].id, f.buyer, exact), (error: unknown) => {
    let cause: any = error
    for (let depth = 0; cause && depth < 8; depth++, cause = cause.cause) if (String(cause.message).includes('injected_release_append_failure')) return true
    return false
  }) }
  finally { await db.$client.execute('DROP TRIGGER injected_release_append_failure') }
  const credit = await import('@/lib/account-credit')
  assert.equal((await credit.creditBalance(f.buyer)).escrow_minor, 100); assert.equal((await credit.creditBalance(f.seller)).available_minor, 0)
  assert.equal((await db.select().from(schema.contract_milestones).where(eq(schema.contract_milestones.id, f.original.milestones[0].id)))[0].state, 'APPROVED')
  assert.equal((await db.select().from(schema.contract_release_operations).where(eq(schema.contract_release_operations.contract_id, f.original.contract.id))).length, 0)
  const released = await release(f.original.contract.id, f.original.milestones[0].id, f.buyer, exact)
  await db.update(schema.credit_entries).set({ available_delta: 39 }).where(eq(schema.credit_entries.id, released.release.sale_entry_id))
  await assert.rejects(release(f.original.contract.id, f.original.milestones[0].id, f.buyer, exact), invalid)
  await assert.rejects(inspect(db, f.original.contract.id, f.original.milestones[0].id, f.buyer, exact.client_reference), invalid)
})

test('reviewed admin buyer-win, seller-win, split and redo preserve original financial references as separate adjudication without invented buyer consent', { skip: !enabled }, async () => {
  for (const ruling of ['buyer_win', 'seller_win', 'split', 'redo']) {
    const f = await fixture(); await startOriginal(f); const dispute = await openDispute(f)
    assert.equal((await adjudicate(f, dispute, ruling, f.buyer)).status, 403)
    const response = await adjudicate(f, dispute, ruling)
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    assert.deepEqual((await response.json()).reviewed_outcome, { basis: 'admin_adjudication', rail: 'credit', distributed_minor: ruling === 'redo' ? 0 : 40 })
    assert.equal((await adjudicate(f, dispute, ruling)).status, 409)
    const original = await (await import('@/lib/contract-original-adjudication')).originalContractAdjudication(db, dispute)
    assert.equal(original.adjudication.ruling, ruling); assert.equal(original.adjudication.basis, 'admin_adjudication')
    assert.equal(original.buyer_acceptance_created, false); assert.equal(original.financial_posting_confirmed, ruling !== 'redo')
    for (const statement of ['UPDATE contract_adjudication_operations SET ruling=\'redo\' WHERE dispute_id=?', 'DELETE FROM contract_adjudication_operations WHERE dispute_id=?',
      'UPDATE contract_disputes SET ruling=\'redo\' WHERE id=?', 'DELETE FROM contract_disputes WHERE id=?']) {
      await assert.rejects(db.$client.execute({ sql: statement, args: [dispute] }), /immutable/)
    }
    const credit = await import('@/lib/account-credit')
    assert.equal((await credit.creditBalance(f.buyer)).available_minor, ruling === 'buyer_win' ? 40 : ruling === 'split' ? 30 : 0)
    assert.equal((await credit.creditBalance(f.seller)).available_minor, ruling === 'seller_win' ? 40 : ruling === 'split' ? 10 : 0)
    assert.equal((await credit.creditBalance(f.buyer)).escrow_minor, ruling === 'redo' ? 100 : 60)
    assert.equal((await reader.originalReviewedContractUse(db, f.original.contract.id))?.remaining_principal_minor, ruling === 'redo' ? 100 : 60)
    assert.equal((await credit.creditBalance(f.feeRecipient)).available_minor, 5)
    for (const table of [schema.contract_acceptance_operations, schema.contract_release_operations]) {
      assert.equal((await db.select().from(table).where(eq(table.contract_id, f.original.contract.id))).length, 0)
    }
    if (ruling === 'buyer_win') {
      const second = await acceptedMilestone(f, 1)
      const result = await (await import('@/lib/contract-original-credit-release')).releaseOriginalContractCredit(f.original.contract.id, f.original.milestones[1].id, f.buyer, second.input)
      assert.equal(result.credit_remaining_principal_minor, 0)
      assert.equal((await credit.creditBalance(f.buyer)).available_minor, 40); assert.equal((await credit.creditBalance(f.seller)).available_minor, 60)
      assert.equal((await reader.organizationContractExposure(db, f.org, f.buyer)).lifetime, 105)
    }
  }
})

test('an actual admin redo preserves older consent but identical replacement output needs a new exact acceptance before original credit release', { skip: !enabled }, async () => {
  const f = await fixture(); await startOriginal(f)
  const first = await acceptedMilestone(f), dispute = await openDispute(f)
  assert.equal((await adjudicate(f, dispute, 'redo')).status, 200)
  const second = await (await import('@/lib/contract-original-submissions')).submitOriginalReviewedContract(f.original.contract.id, f.original.milestones[0].id, f.seller,
    { version: 1, client_reference: crypto.randomUUID(), artifact_bundle: first.submission.submission.artifact_bundle })
  assert.equal(second.submission.content_hash, first.submission.submission.content_hash); assert.notEqual(second.submission.id, first.submission.submission.id)
  const { releaseOriginalContractCredit: release } = await import('@/lib/contract-original-credit-release')
  await assert.rejects(release(f.original.contract.id, f.original.milestones[0].id, f.buyer, first.input),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_RELEASE_SUBMISSION_CHANGED')
  const input = { ...first.input, client_reference: crypto.randomUUID(), submission_id: second.submission.id, content_hash: second.submission.content_hash }
  await assert.rejects(release(f.original.contract.id, f.original.milestones[0].id, f.buyer, input),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_RELEASE_EXACT_ACCEPTANCE_REQUIRED')
  const acceptance = await (await import('@/lib/contract-exact-acceptance')).acceptOriginalReviewedContract(f.original.contract.id, f.original.milestones[0].id, f.buyer,
    { version: 1, client_reference: crypto.randomUUID(), submission_id: second.submission.id, content_hash: second.submission.content_hash, approve: true })
  const result = await release(f.original.contract.id, f.original.milestones[0].id, f.buyer, { ...input, acceptance_id: acceptance.decision.id })
  assert.equal(result.release.basis, 'explicit_buyer_acceptance'); assert.equal(result.credit_remaining_principal_minor, 60)
  const redo = await (await import('@/lib/contract-original-adjudication')).originalContractAdjudication(db, dispute)
  assert.equal(redo.adjudication.ruling, 'redo'); assert.equal(redo.financial_posting_confirmed, false)
  assert.equal(redo.adjudication.settlement_entry_id, null); assert.equal(redo.credit_remaining_principal_minor, 60, 'later payout cannot be adopted as payment by the original redo')
})

test('reviewed admin settlement rejects changed original amounts and missing use before resolving or moving any credit', { skip: !enabled }, async () => {
  for (const mutation of ['amount', 'missing_use']) {
    const f = await fixture(); await startOriginal(f); const dispute = await openDispute(f)
    if (mutation === 'amount') await db.update(schema.contract_milestones).set({ amount: .41 }).where(eq(schema.contract_milestones.id, f.original.milestones[0].id))
    else await db.delete(schema.organization_contract_uses).where(eq(schema.organization_contract_uses.contract_id, f.original.contract.id))
    const response = await adjudicate(f, dispute, 'seller_win')
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'ORGANIZATION_CONTRACT_USE_INVALID')
    assert.equal((await db.select().from(schema.contract_disputes).where(eq(schema.contract_disputes.id, dispute)))[0].state, 'open')
    const credit = await import('@/lib/account-credit')
    assert.equal((await credit.creditBalance(f.buyer)).escrow_minor, 100); assert.equal((await credit.creditBalance(f.seller)).available_minor, 0)
  }
})

test('an admin payout cannot be adopted as a buyer-directed release or paid again through contradictory stored states', { skip: !enabled }, async () => {
  const f = await fixture(); await startOriginal(f)
  const first = await acceptedMilestone(f), dispute = await openDispute(f)
  assert.equal((await adjudicate(f, dispute, 'seller_win')).status, 200)
  const { releaseOriginalContractCredit: release, inspectOriginalContractCreditRelease: inspect } = await import('@/lib/contract-original-credit-release')
  await assert.rejects(inspect(db, f.original.contract.id, f.original.milestones[0].id, f.buyer, first.input.client_reference),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_RELEASE_NOT_FOUND')
  // Stored-state contradiction controls, not legitimate reopen/redo operations.
  await db.update(schema.contract_milestones).set({ state: 'APPROVED' }).where(eq(schema.contract_milestones.id, f.original.milestones[0].id))
  await assert.rejects(release(f.original.contract.id, f.original.milestones[0].id, f.buyer, first.input),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_RELEASE_ALREADY_SETTLED')
  await db.update(schema.contract_milestones).set({ state: 'DISPUTED' }).where(eq(schema.contract_milestones.id, f.original.milestones[0].id))
  const [contradiction] = await db.insert(schema.contract_disputes).values({ contract_id: f.original.contract.id, milestone_id: f.original.milestones[0].id,
    raised_by: f.buyer, reason_code: 'stored-state-contradiction-only', evidence: '{}', state: 'open' }).returning()
  await db.update(schema.contracts).set({ state: 'DISPUTED', dispute_id: contradiction.id }).where(eq(schema.contracts.id, f.original.contract.id))
  const response = await adjudicate(f, contradiction.id, 'seller_win')
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'CONTRACT_REVIEWED_MILESTONE_ALREADY_SETTLED')
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.seller)).available_minor, 40)
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).escrow_minor, 60)
})

test('original admin outcome recovery is participant-private and rejects changed ledger evidence, ambiguous lookup and foreign scope', { skip: !enabled }, async () => {
  const f = await fixture(); await startOriginal(f); const dispute = await openDispute(f)
  assert.equal((await adjudicate(f, dispute, 'split')).status, 200)
  const api = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/route'), { generateJWT: jwt } = await import('@/lib/auth')
  const path = `http://localhost/api/contracts/${f.original.contract.id}/milestones/${f.original.milestones[0].id}`
  const context = { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[0].id }) }
  const token = (actor: string) => jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })
  for (const actor of [f.buyer, f.seller, f.owner, f.reviewer, f.other]) {
    const read = await api.GET(new NextRequest(`${path}?adjudication_reference=${dispute}`, { headers: { Authorization: `Bearer ${token(actor)}` } }), context)
    assert.equal(read.headers.get('Cache-Control'), 'private, no-store')
    if ([f.buyer, f.seller].includes(actor)) {
      assert.equal(read.status, 200); const result = await read.json()
      assert.equal(result.adjudication.buyer_refund_minor, 30); assert.equal(result.adjudication.seller_credit_minor, 10)
      assert.equal(Object.hasOwn(result, 'evidence'), false); assert.equal(result.buyer_acceptance_created, false)
    } else assert.equal(read.status, 404)
  }
  for (const query of [`adjudication_reference=${dispute}&acceptance_reference=old-decision`, `adjudication_reference=${dispute}&client_reference=old-submission`,
    `adjudication_reference=${dispute}&adjudication_reference=${dispute}`, 'adjudication_reference=bad-id', `adjudication_reference=${crypto.randomUUID()}`]) {
    const response = await api.GET(new NextRequest(`${path}?${query}`, { headers: { Authorization: `Bearer ${token(f.buyer)}` } }), context)
    assert.equal(response.status, query.includes('bad-id') || query.includes('&') ? 400 : 404)
  }
  const admin = await import('@/app/api/admin/contracts/disputes/[id]/resolve/route'), previous = process.env.ADMIN_USER_IDS
  process.env.ADMIN_USER_IDS = f.owner
  try {
    const adminPath = `http://localhost/api/admin/contracts/disputes/${dispute}/resolve`, adminContext = { params: Promise.resolve({ id: dispute }) }
    assert.equal((await admin.GET(new NextRequest(adminPath, { headers: { Authorization: `Bearer ${token(f.owner)}` } }), adminContext)).status, 200)
    assert.equal((await admin.GET(new NextRequest(adminPath, { headers: { Authorization: `Bearer ${token(f.buyer)}` } }), adminContext)).status, 403)
  } finally { if (previous === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = previous }
  const op = (await db.select().from(schema.contract_adjudication_operations).where(eq(schema.contract_adjudication_operations.dispute_id, dispute)))[0]
  await db.update(schema.credit_entries).set({ available_delta: 9 }).where(eq(schema.credit_entries.id, op.sale_entry_id!))
  const invalidRead = await api.GET(new NextRequest(`${path}?adjudication_reference=${dispute}`, { headers: { Authorization: `Bearer ${token(f.buyer)}` } }), context)
  assert.equal(invalidRead.status, 409); assert.equal((await invalidRead.json()).code, 'ORGANIZATION_CONTRACT_USE_INVALID')
})

test('a failed immutable admin journal append rolls back ruling, state and original credit distribution', { skip: !enabled }, async () => {
  const f = await fixture(); await startOriginal(f); const dispute = await openDispute(f)
  await db.$client.execute("CREATE TRIGGER injected_adjudication_append_failure BEFORE INSERT ON contract_adjudication_operations BEGIN SELECT RAISE(ABORT, 'injected_adjudication_append_failure'); END")
  try { assert.equal((await adjudicate(f, dispute, 'seller_win')).status, 500) }
  finally { await db.$client.execute('DROP TRIGGER injected_adjudication_append_failure') }
  assert.equal((await db.select().from(schema.contract_disputes).where(eq(schema.contract_disputes.id, dispute)))[0].state, 'open')
  assert.equal((await db.select().from(schema.contract_milestones).where(eq(schema.contract_milestones.id, f.original.milestones[0].id)))[0].state, 'DISPUTED')
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).escrow_minor, 100)
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.seller)).available_minor, 0)
  assert.equal((await db.select().from(schema.contract_adjudication_operations).where(eq(schema.contract_adjudication_operations.dispute_id, dispute))).length, 0)
  assert.equal((await adjudicate(f, dispute, 'seller_win')).status, 200)
})

test('a genuinely lost committed admin resolution reply recovers its original split through both participant SDKs without repeating resolution', { skip: !enabled }, async () => {
  const f = await fixture(); await startOriginal(f); const dispute = await openDispute(f)
  const admin = await import('@/app/api/admin/contracts/disputes/[id]/resolve/route'), api = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/route'), { generateJWT: jwt } = await import('@/lib/auth')
  const token = (actor: string) => jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })
  const calls: string[] = [], previous = process.env.ADMIN_USER_IDS; process.env.ADMIN_USER_IDS = f.owner
  const server = createServer(async (incoming, outgoing) => {
    try {
      let body = ''; for await (const chunk of incoming) body += chunk
      calls.push(incoming.method!)
      const request = new NextRequest(`http://localhost${incoming.url}`, { method: incoming.method, headers: { Authorization: incoming.headers.authorization!,
        'Content-Type': 'application/json' }, ...(incoming.method === 'PATCH' ? { body } : {}) })
      const response = incoming.method === 'PATCH' ? await admin.PATCH(request, { params: Promise.resolve({ id: dispute }) })
        : await api.GET(request, { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[0].id }) })
      if (incoming.method === 'PATCH') { assert.equal(response.status, 200); outgoing.destroy() }
      else { outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text()) }
    } catch (error) { outgoing.statusCode = 500; outgoing.end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    await assert.rejects(fetch(`${base}/api/admin/contracts/disputes/${dispute}/resolve`, { method: 'PATCH', headers: {
      Authorization: `Bearer ${token(f.owner)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ruling: 'split', split_percent_to_seller: 25 }) }))
    assert.deepEqual(calls, ['PATCH'])
    const client = new ClawdMarketClient({ apiKey: token(f.buyer), baseUrl: base })
    const original = await client.recoverOriginalContractAdjudication(f.original.contract.id, f.original.milestones[0].id, dispute)
    const source = `import json, os
from clawdmarket import ClawdMarketClient
f=json.loads(os.environ['CLAWDMARKET_LOCAL_ADJUDICATION_FIXTURE'])
c=ClawdMarketClient(f['token'], base_url=f['base'])
print(json.dumps(c.recover_original_contract_adjudication(f['contract'], f['milestone'], f['dispute'])))`
    const output = await promisify(execFile)('python3', ['-c', source], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: 'sdk/python',
      CLAWDMARKET_LOCAL_ADJUDICATION_FIXTURE: JSON.stringify({ token: token(f.seller), base, contract: f.original.contract.id, milestone: f.original.milestones[0].id, dispute }) }, timeout: 30000 })
    assert.deepEqual(JSON.parse(output.stdout).adjudication, original.adjudication)
    assert.equal(original.adjudication.buyer_refund_minor, 30); assert.equal(original.adjudication.seller_credit_minor, 10)
    assert.equal(original.financial_posting_confirmed, true); assert.equal(original.buyer_acceptance_created, false)
    assert.deepEqual(calls, ['PATCH', 'GET', 'GET'])
    assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).escrow_minor, 60)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    if (previous === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = previous
  }
})

test('ordinary unreviewed contracts retain all four existing admin rulings without inferred reviewed operations or consent', { skip: !enabled }, async () => {
  const credit = await import('@/lib/account-credit'), api = await import('@/app/api/contracts/[id]/route'), { generateJWT: jwt } = await import('@/lib/auth')
  for (const ruling of ['buyer_win', 'seller_win', 'split', 'redo']) {
    const f = await reviewedContractFixture({ db, schema }) // Creates a real public DRAFT, no review companion.
    // The review fixture requires approval above 50 cents. This ordinary-path
    // positive control explicitly permits its $1.05 reservation below a $5 cap.
    await db.update(schema.buyer_spend_policies).set({ policy_json: '{"max_per_execution":500,"approval_required_above":500}' })
      .where(eq(schema.buyer_spend_policies.buyer_id, f.buyer))
    const deposit = await credit.createDeposit(f.buyer, { amount_minor: 105, payer: payer.address, client_reference: crypto.randomUUID() })
    await alignDisposableDepositClock(deposit.id)
    const txHash = await wallet.writeContract({ account: payer, chain: { ...mainnet, id: 8453 }, address: chain.token, abi: erc20Abi,
      functionName: 'transfer', args: [chain.treasury, 1_050_000n] })
    await chain.client.waitForTransactionReceipt({ hash: txHash })
    await credit.confirmDeposit(f.buyer, { id: deposit.id, tx_hash: txHash, signature: await payer.signMessage({ message: creditDepositMessage(deposit, txHash) }) })
    const funded = await api.PATCH(new NextRequest(`http://localhost/api/contracts/${f.original.contract.id}`, { method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt({ userId: f.buyer, email: `${f.buyer}@test.invalid`, role: 'human' })}` },
      body: JSON.stringify({ action: 'fund' }) }), { params: Promise.resolve({ id: f.original.contract.id }) })
    assert.equal(funded.status, 200, JSON.stringify(await funded.clone().json()))
    await startOriginal(f); const dispute = await openDispute(f), result = await adjudicate(f, dispute, ruling)
    assert.equal(result.status, 200); assert.equal(Object.hasOwn(await result.json(), 'reviewed_outcome'), false)
    assert.equal((await credit.creditBalance(f.buyer)).available_minor, ruling === 'buyer_win' ? 40 : ruling === 'split' ? 30 : 0)
    assert.equal((await credit.creditBalance(f.seller)).available_minor, ruling === 'seller_win' ? 40 : ruling === 'split' ? 10 : 0)
    assert.equal((await credit.creditBalance(f.buyer)).escrow_minor, ruling === 'redo' ? 100 : 60)
    assert.equal((await db.select().from(schema.contract_adjudication_operations).where(eq(schema.contract_adjudication_operations.dispute_id, dispute))).length, 0)
    await assert.rejects((await import('@/lib/contract-original-adjudication')).originalContractAdjudication(db, dispute),
      (error: unknown) => (error as { code: string }).code === 'CONTRACT_ADJUDICATION_NOT_FOUND')
  }
})

test('dedicated original seller POST enforces actor, payment scope, CSRF and bounded finite output while legacy hashless submit stays blocked', { skip: !enabled }, async () => {
  const f = await fixture(); await startOriginal(f)
  const api = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/submissions/route'), { generateJWT: jwt } = await import('@/lib/auth')
  const context = { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[0].id }) }
  const path = `http://localhost/api/contracts/${f.original.contract.id}/milestones/${f.original.milestones[0].id}/submissions`
  const input = { version: 1, client_reference: crypto.randomUUID(), artifact_bundle: { report: 'Private original seller output' } }
  const token = (actor: string) => jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })
  const post = (actor: string, body: unknown = input, headers?: Record<string, string>) => api.POST(new NextRequest(path, { method: 'POST',
    headers: { Authorization: `Bearer ${token(actor)}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }), context)
  for (const actor of [f.owner, f.reviewer, f.other]) assert.equal((await post(actor)).status, 404)
  assert.equal((await post(f.buyer)).status, 403)
  assert.equal((await post(f.seller, input, { Authorization: 'Bearer invalid', Cookie: `auth-token=${token(f.seller)}` })).status, 403)
  const { createNamedAgentCredential } = await import('@/lib/agent-named-credentials')
  const read = await createNamedAgentCredential({ agentId: f.providerAgent, name: 'Read only provider', scopes: ['agent:read'], actorCredentialId: null })
  assert.equal(read.kind, 'created'); if (read.kind !== 'created') throw new Error('Read fixture failed')
  assert.equal((await post(f.seller, input, { Authorization: '', 'X-ClawdMarket-Agent-Key': read.api_key })).status, 401)
  assert.equal((await post(f.seller, { artifact_bundle: {} })).status, 400)
  assert.equal((await post(f.seller, { ...input, artifact_bundle: { report: 'x'.repeat(96001) } })).status, 413)
  const response = await post(f.seller)
  assert.equal(response.status, 201); assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  const first = await response.json(); assert.equal(first.submission.authorizes_payment, false)
  assert.equal(first.submission.remote_execution_observed, false); assert.equal(first.credit_remaining_principal_minor, 100)
  assert.equal((await post(f.seller)).status, 200)
  assert.equal((await post(f.seller, { ...input, artifact_bundle: { report: 'Changed same reference' } })).status, 409)
  const parent = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/route')
  assert.equal((await parent.PATCH(new NextRequest(path.replace('/submissions', ''), { method: 'PATCH', headers: {
    Authorization: `Bearer ${token(f.seller)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit', artifact_bundle: input.artifact_bundle }) }), context)).status, 409)
  assert.equal((await db.select().from(schema.contract_acceptance_operations).where(eq(schema.contract_acceptance_operations.contract_id, f.original.contract.id))).length, 0)
})

test('both provider SDKs recover actual lost committed original submission replies without recomputation, new output or credit release', { skip: !enabled }, async () => {
  const post = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/submissions/route'), get = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/route'), { generateJWT: jwt } = await import('@/lib/auth')
  for (const language of ['typescript', 'python']) {
    const f = await fixture(); await startOriginal(f)
    const input = { version: 1 as const, client_reference: crypto.randomUUID(), artifact_bundle: { report: 'Saved original finite output before sending' } }
    const token = jwt({ userId: f.seller, email: `${f.seller}@test.invalid`, role: 'human' })
    const calls: Array<{ method: string; body: unknown }> = []; let committed: any
    const server = createServer(async (incoming, outgoing) => {
      try {
        let body = ''; for await (const chunk of incoming) body += chunk
        calls.push({ method: incoming.method!, body: body ? JSON.parse(body) : null })
        const request = new NextRequest(`http://localhost${incoming.url}`, { method: incoming.method, headers: { Authorization: incoming.headers.authorization!, 'Content-Type': 'application/json' }, ...(incoming.method === 'POST' ? { body } : {}) })
        const context = { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[0].id }) }
        const response = await (incoming.method === 'POST' ? post.POST(request, context) : get.GET(request, context))
        const result = await response.json()
        if (!committed && incoming.method === 'POST') {
          assert.equal(response.status, 201); committed = result
          await domain.revokeOrganizationContract(f.org, f.a.id, f.owner)
          outgoing.destroy()
        } else { outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(JSON.stringify(result)) }
      } catch (error) { outgoing.statusCode = 500; outgoing.end(JSON.stringify({ error: String(error) })) }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      let result: any
      if (language === 'typescript') {
        const client = new ClawdMarketClient({ apiKey: token, baseUrl: base })
        await assert.rejects(client.submitOriginalContractOutput(f.original.contract.id, f.original.milestones[0].id, input), ClawdMarketTransportError)
        assert.equal(calls.length, 1)
        result = { recovered: await client.inspectOriginalContractSubmission(f.original.contract.id, f.original.milestones[0].id, input.client_reference),
          replay: await client.submitOriginalContractOutput(f.original.contract.id, f.original.milestones[0].id, input) }
      } else {
        const source = `import os,json
from clawdmarket import ClawdMarketClient,ClawdMarketTransportError
f=json.loads(os.environ['CLAWDMARKET_LOCAL_OUTPUT_FIXTURE']);c=ClawdMarketClient(f['token'],base_url=f['base'])
try:
    c.submit_original_contract_output(f['contract'],f['milestone'],f['input'])
except ClawdMarketTransportError:
    pass
else:
    raise AssertionError('Expected lost committed reply')
r=c.inspect_original_contract_submission(f['contract'],f['milestone'],f['input']['client_reference'])
p=c.submit_original_contract_output(f['contract'],f['milestone'],f['input'])
print(json.dumps({'recovered':r,'replay':p}))`
        const output = await promisify(execFile)('python3', ['-c', source], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: 'sdk/python',
          CLAWDMARKET_LOCAL_OUTPUT_FIXTURE: JSON.stringify({ token, base, contract: f.original.contract.id, milestone: f.original.milestones[0].id, input }) }, timeout: 30000 })
        result = JSON.parse(output.stdout)
      }
      assert.deepEqual(calls.map(c => c.method), ['POST', 'GET', 'POST'])
      assert.deepEqual(calls[0].body, input); assert.deepEqual(calls[2].body, input)
      assert.equal(result.recovered.submission.id, committed.submission.id); assert.equal(result.replay.submission.id, committed.submission.id)
      assert.equal(result.replay.submission.content_hash, committed.submission.content_hash); assert.equal(result.replay.idempotent, true)
      assert.equal(result.replay.credit_remaining_principal_minor, 100)
      assert.equal((await db.select().from(schema.contract_submission_operations).where(eq(schema.contract_submission_operations.contract_id, f.original.contract.id))).length, 1)
      assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).escrow_minor, 100)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  }
})

test('exact public credit release enforces buyer/payment scope and original proof; generic hashless mark_paid remains blocked', { skip: !enabled }, async () => {
  const f = await fixture(); await startOriginal(f); const first = await acceptedMilestone(f)
  const api = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/release/route'), get = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/route'), { generateJWT: jwt } = await import('@/lib/auth')
  const path = `http://localhost/api/contracts/${f.original.contract.id}/milestones/${f.original.milestones[0].id}`
  const context = { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[0].id }) }
  const token = (actor: string) => jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })
  const post = (actor: string, body: unknown = first.input, headers?: Record<string, string>) => api.POST(new NextRequest(`${path}/release`, { method: 'POST',
    headers: { Authorization: `Bearer ${token(actor)}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }), context)
  for (const actor of [f.owner, f.reviewer, f.other]) assert.equal((await post(actor)).status, 404)
  assert.equal((await post(f.seller)).status, 403)
  assert.equal((await post(f.buyer, first.input, { Authorization: 'Bearer invalid', Cookie: `auth-token=${token(f.buyer)}` })).status, 403)
  assert.equal((await post(f.buyer, { ...first.input, acceptance_id: crypto.randomUUID() })).status, 409)
  assert.equal((await post(f.buyer, { ...first.input, content_hash: '0'.repeat(64) })).status, 409)
  assert.equal((await post(f.buyer, { version: 1 })).status, 400)
  const { createNamedAgentCredential } = await import('@/lib/agent-named-credentials')
  for (const scopes of [['agent:read'], ['marketplace:write']]) {
    const key = await createNamedAgentCredential({ agentId: f.buyerAgent, name: scopes[0], scopes: scopes as any, actorCredentialId: null })
    assert.equal(key.kind, 'created'); if (key.kind !== 'created') throw new Error('Credential fixture failed')
    assert.equal((await post(f.buyer, first.input, { Authorization: '', 'X-ClawdMarket-Agent-Key': key.api_key })).status, 401)
  }
  const pay = await createNamedAgentCredential({ agentId: f.buyerAgent, name: 'Original release only', scopes: ['payments:write'], actorCredentialId: null })
  assert.equal(pay.kind, 'created'); if (pay.kind !== 'created') throw new Error('Credential fixture failed')
  const response = await post(f.buyer, first.input, { Authorization: '', 'X-ClawdMarket-Agent-Key': pay.api_key })
  assert.equal(response.status, 201); assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  const result = await response.json(); assert.equal(result.financial_posting_confirmed, true); assert.equal(result.release.seller_receives, 'nonwithdrawable_account_credit')
  assert.equal(result.credit_remaining_principal_minor, 60); assert.equal((await post(f.buyer)).status, 200)
  for (const actor of [f.buyer, f.seller, f.owner, f.reviewer]) {
    const read = await get.GET(new NextRequest(`${path}?release_reference=${first.input.client_reference}`, { headers: { Authorization: `Bearer ${token(actor)}` } }), context)
    assert.equal(read.status, [f.buyer, f.seller].includes(actor) ? 200 : 404)
    if (read.status === 200) assert.equal((await read.json()).release.id, result.release.id)
  }
  for (const query of [`release_reference=${first.input.client_reference}&client_reference=other-reference`, `release_reference=${first.input.client_reference}&acceptance_reference=other-reference`,
    `release_reference=${first.input.client_reference}&adjudication_reference=${crypto.randomUUID()}`, `release_reference=${first.input.client_reference}&release_reference=${first.input.client_reference}`]) {
    assert.equal((await get.GET(new NextRequest(`${path}?${query}`, { headers: { Authorization: `Bearer ${token(f.buyer)}` } }), context)).status, 400)
  }
  assert.equal((await get.PATCH(new NextRequest(path, { method: 'PATCH', headers: { Authorization: `Bearer ${token(f.buyer)}`, 'Content-Type': 'application/json' }, body: '{"action":"mark_paid"}' }), context)).status, 409)
})

test('inconsistent held-credit account cannot request more funding or commit a partial release through the public adapter', { skip: !enabled }, async () => {
  const f = await fixture(); await startOriginal(f); const first = await acceptedMilestone(f)
  await db.update(schema.credit_accounts).set({ escrow_minor: 0 }).where(eq(schema.credit_accounts.user_id, f.buyer))
  const api = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/release/route'), { generateJWT: jwt } = await import('@/lib/auth')
  try {
    const response = await api.POST(new NextRequest(`http://localhost/api/contracts/${f.original.contract.id}/milestones/${f.original.milestones[0].id}/release`, { method: 'POST',
      headers: { Authorization: `Bearer ${jwt({ userId: f.buyer, email: `${f.buyer}@test.invalid`, role: 'human' })}`, 'Content-Type': 'application/json' }, body: JSON.stringify(first.input) }),
    { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[0].id }) })
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'CONTRACT_ORIGINAL_CREDIT_POSTING_UNAVAILABLE')
    assert.equal((await db.select().from(schema.contract_milestones).where(eq(schema.contract_milestones.id, f.original.milestones[0].id)))[0].state, 'APPROVED')
    assert.equal((await db.select().from(schema.contract_release_operations).where(eq(schema.contract_release_operations.contract_id, f.original.contract.id))).length, 0)
    assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.seller)).available_minor, 0)
  } finally { await db.update(schema.credit_accounts).set({ escrow_minor: 100 }).where(eq(schema.credit_accounts.user_id, f.buyer)) }
})

test('both buyer SDKs recover actual lost committed release replies and original posting after full completion without double payment', { skip: !enabled }, async () => {
  const api = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/release/route'), get = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/route'), output = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/submissions/route'), { generateJWT: jwt } = await import('@/lib/auth')
  for (const language of ['typescript', 'python']) {
    const f = await fixture(); await startOriginal(f)
    const token = (actor: string) => jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })
    async function publicAcceptance(index: number) {
      const context = { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[index].id }) }
      const path = `http://localhost/api/contracts/${f.original.contract.id}/milestones/${f.original.milestones[index].id}`
      const submitted = await output.POST(new NextRequest(`${path}/submissions`, { method: 'POST', headers: { Authorization: `Bearer ${token(f.seller)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 1, client_reference: crypto.randomUUID(), artifact_bundle: { report: 'Exact public fulfillment' } }) }), context)
      assert.equal(submitted.status, 201); const work = await submitted.json()
      const accepted = await get.PATCH(new NextRequest(path, { method: 'PATCH', headers: { Authorization: `Bearer ${token(f.buyer)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', version: 1, client_reference: crypto.randomUUID(), submission_id: work.submission.id, content_hash: work.submission.content_hash, approve: true }) }), context)
      assert.equal(accepted.status, 201); const decision = await accepted.json()
      return { version: 1 as const, client_reference: crypto.randomUUID(), submission_id: work.submission.id, content_hash: work.submission.content_hash, acceptance_id: decision.decision.id }
    }
    const input = await publicAcceptance(0), calls: Array<{ method: string; body: unknown }> = []; let committed: any
    const server = createServer(async (incoming, outgoing) => {
      try {
        let body = ''; for await (const chunk of incoming) body += chunk
        calls.push({ method: incoming.method!, body: body ? JSON.parse(body) : null })
        const request = new NextRequest(`http://localhost${incoming.url}`, { method: incoming.method, headers: { Authorization: incoming.headers.authorization!, 'Content-Type': 'application/json' }, ...(incoming.method === 'POST' ? { body } : {}) })
        const context = { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[0].id }) }
        const response = await (incoming.method === 'POST' ? api.POST(request, context) : get.GET(request, context)), result = await response.json()
        if (!committed && incoming.method === 'POST') {
          assert.equal(response.status, 201); committed = result
          await domain.revokeOrganizationContract(f.org, f.a.id, f.owner)
          outgoing.destroy()
        } else { outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(JSON.stringify(result)) }
      } catch (error) { outgoing.statusCode = 500; outgoing.end(JSON.stringify({ error: String(error) })) }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`, client = new ClawdMarketClient({ apiKey: token(f.buyer), baseUrl: base })
      let result: any
      if (language === 'typescript') {
        await assert.rejects(client.releaseOriginalContractCredit(f.original.contract.id, f.original.milestones[0].id, input), ClawdMarketTransportError)
        assert.equal(calls.length, 1)
        result = { recovered: await client.recoverOriginalContractCreditRelease(f.original.contract.id, f.original.milestones[0].id, input.client_reference),
          replay: await client.releaseOriginalContractCredit(f.original.contract.id, f.original.milestones[0].id, input) }
      } else {
        const source = `import os,json
from clawdmarket import ClawdMarketClient,ClawdMarketTransportError
f=json.loads(os.environ['CLAWDMARKET_LOCAL_RELEASE_FIXTURE']);c=ClawdMarketClient(f['token'],base_url=f['base'])
try:
    c.release_original_contract_credit(f['contract'],f['milestone'],f['input'])
except ClawdMarketTransportError:
    pass
else:
    raise AssertionError('Expected lost committed release reply')
r=c.recover_original_contract_credit_release(f['contract'],f['milestone'],f['input']['client_reference'])
p=c.release_original_contract_credit(f['contract'],f['milestone'],f['input'])
print(json.dumps({'recovered':r,'replay':p}))`
        const processResult = await promisify(execFile)('python3', ['-c', source], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: 'sdk/python',
          CLAWDMARKET_LOCAL_RELEASE_FIXTURE: JSON.stringify({ token: token(f.buyer), base, contract: f.original.contract.id, milestone: f.original.milestones[0].id, input }) }, timeout: 30000 })
        result = JSON.parse(processResult.stdout)
      }
      assert.deepEqual(calls.map(c => c.method), ['POST', 'GET', 'POST']); assert.deepEqual(calls[0].body, input); assert.deepEqual(calls[2].body, input)
      assert.deepEqual(result.recovered.release, committed.release); assert.deepEqual(result.replay.release, committed.release)
      assert.equal(result.recovered.financial_posting_confirmed, true); assert.equal(result.replay.idempotent, true)
      assert.equal(result.replay.credit_remaining_principal_minor, 60)
      const second = await publicAcceptance(1)
      const done = await api.POST(new NextRequest(`http://localhost/api/contracts/${f.original.contract.id}/milestones/${f.original.milestones[1].id}/release`, { method: 'POST',
        headers: { Authorization: `Bearer ${token(f.buyer)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(second) }),
      { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[1].id }) })
      assert.equal(done.status, 201); assert.equal((await done.json()).credit_remaining_principal_minor, 0)
      const recovered = await client.recoverOriginalContractCreditRelease(f.original.contract.id, f.original.milestones[0].id, input.client_reference)
      assert.equal(recovered.release.id, committed.release.id); assert.equal(recovered.credit_remaining_principal_minor, 0)
      assert.equal((await client.releaseOriginalContractCredit(f.original.contract.id, f.original.milestones[0].id, input)).idempotent, true)
      const credit = await import('@/lib/account-credit')
      assert.equal((await credit.creditBalance(f.seller)).available_minor, 100); assert.equal((await credit.creditBalance(f.buyer)).escrow_minor, 0)
      assert.equal((await credit.creditBalance(f.feeRecipient)).available_minor, 5)
      assert.equal((await reader.organizationContractExposure(db, f.org, f.buyer)).lifetime, 105)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  }
})

test('original buyer funding reference pins one controlled original reservation and recovers frozen terms after current permission closes', { skip: !enabled }, async () => {
  const f = await fixture(true), refs = await import('@/lib/contract-original-funding-reference')
  const original = await refs.inspectOriginalContractFunding(db, f.org, f.a.id, f.buyer, f.funding.client_reference)
  assert.equal(original.contract.id, f.original.contract.id); assert.equal(original.funding.gross_minor, 105)
  assert.equal(original.funding.upfront_fee_minor, 5); assert.equal(original.funding.principal_minor, 100)
  assert.equal(original.funding.fee_recipient_id, f.feeRecipient); assert.equal(original.funding.redeemable, false)
  assert.equal(original.funding.seller_receives, 'nonwithdrawable_account_credit'); assert.equal(original.credit_remaining_principal_minor, 100)
  await domain.revokeOrganizationContract(f.org, f.a.id, f.owner)
  await db.update(schema.organizations).set({ owner_account_id: f.other }).where(eq(schema.organizations.id, f.org))
  await db.update(schema.organization_agent_assignments).set({ cost_center: 'CHANGED_AFTER_FUNDING' }).where(eq(schema.organization_agent_assignments.agent_id, f.buyerAgent))
  await db.update(schema.seller_payment_preferences).set({ supported_rails: '[]' }).where(eq(schema.seller_payment_preferences.seller_id, f.seller))
  await db.update(schema.contract_milestones).set({ acceptance_spec: '{"required_artifacts":["CHANGED"]}' }).where(eq(schema.contract_milestones.id, f.original.milestones[0].id))
  assert.deepEqual((await refs.inspectOriginalContractFunding(db, f.org, f.a.id, f.buyer, f.funding.client_reference)).original_terms, original.original_terms)
  assert.deepEqual(original.original_terms.milestones[0].acceptance_spec.required_artifacts, ['report'])
  assert.equal((await refs.recoverOriginalContractFundingCommand(db, f.org, f.a.id, f.buyer, f.funding))?.idempotent, true)
  assert.equal((await db.select().from(schema.organization_contract_funding_requests).where(eq(schema.organization_contract_funding_requests.buyer_id, f.buyer))).length, 1)
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).escrow_minor, 100)
  for (const statement of ['UPDATE organization_contract_funding_requests SET request_hash=\'changed\' WHERE id=?', 'DELETE FROM organization_contract_funding_requests WHERE id=?']) {
    await assert.rejects(db.$client.execute({ sql: statement, args: [original.funding.id] }), /immutable/)
  }
})

test('funding references reject changed and cross-contract reuse and private actors without reclassifying earlier unreferenced reservations', { skip: !enabled }, async () => {
  const f = await fixture(true), other = await fixture(), refs = await import('@/lib/contract-original-funding-reference')
  for (const actor of [f.owner, f.reviewer, f.seller, f.other]) await assert.rejects(refs.inspectOriginalContractFunding(db, f.org, f.a.id, actor, f.funding.client_reference),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_FUND_REFERENCE_NOT_FOUND')
  for (const [org, id, input] of [[other.org, other.a.id, f.funding], [f.org, f.a.id, { ...f.funding, authority_hash: '0'.repeat(64) }]] as const) {
    await assert.rejects(refs.recoverOriginalContractFundingCommand(db, org, id, f.buyer, input),
      (error: unknown) => (error as { code: string }).code === 'CONTRACT_FUND_REFERENCE_CONFLICT')
  }
  assert.equal(await refs.recoverOriginalContractFundingCommand(db, other.org, other.a.id, other.buyer, other.funding), null)
  await assert.rejects(refs.inspectOriginalContractFunding(db, other.org, other.a.id, other.buyer, other.funding.client_reference),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_FUND_REFERENCE_NOT_FOUND')
  assert.ok(await reader.originalReviewedContractUse(db, other.original.contract.id), 'old original reservation retains financial meaning but gains no request receipt')
  assert.equal((await db.select().from(schema.organization_contract_funding_requests).where(eq(schema.organization_contract_funding_requests.contract_id, other.original.contract.id))).length, 0)
  const [request] = await db.select().from(schema.organization_contract_funding_requests).where(eq(schema.organization_contract_funding_requests.contract_id, f.original.contract.id))
  // Constraint control: even a direct insert cannot reuse buyer/reference under other existing financial IDs.
  await assert.rejects(db.insert(schema.organization_contract_funding_requests).values({ ...request, id: crypto.randomUUID(), organization_id: other.org,
    authorization_id: other.a.id, contract_id: other.original.contract.id }), (error: unknown) => {
    let cause: any = error
    for (let depth = 0; cause && depth < 8; depth++, cause = cause.cause) {
      if (String(cause.message).includes('UNIQUE constraint failed: organization_contract_funding_requests.buyer_id, organization_contract_funding_requests.client_reference')) return true
    }
    return false
  })
})

test('a saved funding reference cannot turn contradictory ledger evidence into original financial success', { skip: !enabled }, async () => {
  const f = await fixture(true), refs = await import('@/lib/contract-original-funding-reference')
  const entries = await db.select().from(schema.credit_entries).where(eq(schema.credit_entries.reference, f.original.contract.id))
  const entry = entries.find(e => e.kind === 'purchase'); assert.ok(entry)
  await db.update(schema.credit_entries).set({ available_delta: -104 }).where(eq(schema.credit_entries.id, entry.id))
  await assert.rejects(refs.inspectOriginalContractFunding(db, f.org, f.a.id, f.buyer, f.funding.client_reference), invalid)
  await assert.rejects(refs.recoverOriginalContractFundingCommand(db, f.org, f.a.id, f.buyer, f.funding), invalid)
})
