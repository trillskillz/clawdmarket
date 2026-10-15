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

const enabled = Boolean(process.env.CLAWDMARKET_TEST_ANVIL_BINARY)
const payer = privateKeyToAccount(`0x${'18'.repeat(32)}`), treasuryKey = `0x${'99'.repeat(32)}` as const
let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let chain: Awaited<ReturnType<typeof startDisposableWorkflowChain>>, wallet: ReturnType<typeof createWalletClient>
let domain: typeof import('@/lib/organization-contract-authorizations'), reader: typeof import('@/lib/organization-contract-uses')
const digest = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
before(async () => {
  if (!enabled) return
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-contract-refund-recovery-'))
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'uses.db')}`, TURSO_AUTH_TOKEN: '', JWT_SECRET: 'contract-refund-recovery-fixture-only',
    AGENT_API_KEY_PEPPER: 'contract-refund-recovery-fixture-only', WEBHOOK_SECRET_KEY: 'contract-refund-recovery-fixture-only',
    CHAT_ENCRYPTION_KEY: 'contract-refund-recovery-fixture-only', CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true' })
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

async function fixture() {
  const f = await reviewedContractFixture({ db, schema }, true, true), credit = await import('@/lib/account-credit')
  const deposit = await credit.createDeposit(f.buyer, { amount_minor: 105, payer: payer.address, client_reference: crypto.randomUUID() })
  // Advance only the disposable node before sending; keep the real not-before proof guard intact.
  const [intent] = await db.select().from(schema.credit_deposits).where(eq(schema.credit_deposits.id, deposit.id))
  const latest = await chain.rpc('eth_getBlockByNumber', ['latest', false])
  await chain.rpc('evm_setNextBlockTimestamp', [Math.max(Math.floor(Date.now() / 1000) + 1,
    Math.floor(intent.created_at.getTime() / 1000) + 1, Number(BigInt(latest.timestamp)) + 1)])
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
    await tx.update(schema.listings).set({ status: 'sold' }).where(eq(schema.listings.id, f.listing.id))
    await tx.update(schema.contracts).set({ state: 'FUNDED', funded_at: now }).where(eq(schema.contracts.id, f.original.contract.id))
    await (await import('@/lib/organization-budgets')).attributeOrganizationContract(tx, f.buyerAgent, f.original.contract.id, 105, now)
    await credit.reserveCredit(tx, { id: f.original.contract.id, buyer: f.buyer, feeRecipient, total: 105, seller: 100, fee: 5 })
    await tx.insert(schema.organization_contract_uses).values({ authorization_id: a.id, contract_id: f.original.contract.id,
      fee_recipient_id: feeRecipient, authority_hash: a.authority_hash, client_reference: funding.client_reference,
      request_hash: digest(funding), amount_minor: 105, created_at: now })
  })
  return { ...f, a, feeRecipient, funding }
}

async function act(f: Awaited<ReturnType<typeof fixture>>, action: string) {
  const { PATCH } = await import('@/app/api/contracts/[id]/route'), { generateJWT: jwt } = await import('@/lib/auth')
  return PATCH(new NextRequest(`http://localhost/api/contracts/${f.original.contract.id}`, { method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt({ userId: f.buyer, email: `${f.buyer}@test.invalid`, role: 'human' })}` },
    body: JSON.stringify({ action }) }), { params: Promise.resolve({ id: f.original.contract.id }) })
}
async function maintenance() {
  const before = process.env.MAINTENANCE_SECRET; process.env.MAINTENANCE_SECRET = 'contract-refund-local-maintenance-only'
  try {
    return await (await import('@/app/api/contracts/maintenance/route')).POST(new NextRequest('http://localhost/api/contracts/maintenance', {
      method: 'POST', headers: { 'x-maintenance-secret': process.env.MAINTENANCE_SECRET } }))
  } finally { if (before === undefined) delete process.env.MAINTENANCE_SECRET; else process.env.MAINTENANCE_SECRET = before }
}
async function refunded(f: Awaited<ReturnType<typeof fixture>>) {
  const credit = await import('@/lib/account-credit')
  assert.equal((await credit.creditBalance(f.buyer)).available_minor, 100); assert.equal((await credit.creditBalance(f.buyer)).escrow_minor, 0)
  assert.equal((await credit.creditBalance(f.seller)).available_minor, 0); assert.equal((await credit.creditBalance(f.feeRecipient)).available_minor, 5)
  assert.equal((await reader.originalReviewedContractUse(db, f.original.contract.id))?.remaining_principal_minor, 0)
  assert.equal((await reader.organizationContractExposure(db, f.org, f.buyer)).lifetime, 105)
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, f.listing.id)))[0].status, 'sold', 'reviewed consumption cannot be relisted by refund')
  const entries = await db.select().from(schema.credit_entries).where(eq(schema.credit_entries.reference, f.original.contract.id))
  assert.equal(entries.filter(e => e.kind === 'contract_settlement:refund').length, 1)
  assert.equal(entries.filter(e => e.kind.startsWith('contract_sale:')).length, 0)
}

test('original reviewed cancellation preserves consumed listing, principal/fee terms and gross after current permission closes', { skip: !enabled }, async () => {
  const f = await fixture()
  await domain.revokeOrganizationContract(f.org, f.a.id, f.owner)
  await db.update(schema.organizations).set({ owner_account_id: f.other }).where(eq(schema.organizations.id, f.org))
  await db.update(schema.organization_agent_assignments).set({ cost_center: 'CURRENT_CLOSED' }).where(eq(schema.organization_agent_assignments.agent_id, f.buyerAgent))
  await db.update(schema.seller_payment_preferences).set({ supported_rails: '[]' }).where(eq(schema.seller_payment_preferences.seller_id, f.seller))
  assert.equal((await act(f, 'cancel')).status, 200); await refunded(f)
  assert.equal((await act(f, 'cancel')).status, 409); await refunded(f)
})

test('mutable expired metadata cannot expire or refund a reviewed obligation before its frozen original deadline', { skip: !enabled }, async () => {
  const f = await fixture()
  await db.update(schema.contracts).set({ expires_at: new Date(Date.now() - 60000) }).where(eq(schema.contracts.id, f.original.contract.id))
  assert.equal((await act(f, 'expire')).status, 400)
  const response = await maintenance(); assert.equal(response.status, 200)
  assert.equal((await response.json()).expired_contracts, 0)
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).escrow_minor, 100)
  assert.equal((await act(f, 'cancel')).status, 200); await refunded(f)
})

for (const mode of ['manual', 'maintenance']) test(`${mode} expiration uses frozen original deadline even if current metadata extends or removes it, and never recycles consumed inventory`, { skip: !enabled }, async t => {
  const f = await fixture(), originalExpiry = Date.parse(f.original.contract.expires_at)
  await db.update(schema.contracts).set({ expires_at: mode === 'manual' ? new Date(originalExpiry + 86400000) : null }).where(eq(schema.contracts.id, f.original.contract.id))
  t.mock.timers.enable({ apis: ['Date'], now: originalExpiry + 1000 })
  try {
    const response = mode === 'manual' ? await act(f, 'expire') : await maintenance()
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    if (mode === 'maintenance') assert.equal((await response.json()).expired_contracts, 1)
    await refunded(f)
    if (mode === 'manual') assert.equal((await act(f, 'expire')).status, 409)
    else assert.equal((await (await maintenance()).json()).expired_contracts, 0)
    await refunded(f)
  } finally { t.mock.timers.reset() }
})

test('free contract review does not consume listing inventory before original funding use exists', { skip: !enabled }, async () => {
  const f = await reviewedContractFixture({ db, schema }, true, true)
  await domain.proposeOrganizationContract(f.org, f.owner, domain.organizationContractInput.parse(f.input))
  const visibility = await import('@/lib/listing-visibility')
  assert.equal(await visibility.originalReviewedContractListing(f.listing.id), false)
  assert.equal((await (await import('@/lib/contract-listing-scope')).requireContractListingScope(db, f.listing.id, { fundingBuyer: f.other })).id, f.listing.id)
  const catalog = await (await import('@/app/api/listings/route')).GET(new NextRequest(`http://localhost/api/listings?seller_id=${f.seller}&status=active`))
  assert.equal(catalog.status, 200); assert.equal(JSON.stringify(await catalog.json()).includes(f.listing.id), true)
})

test('consumed original reviewed contract listing cannot reenter catalog, fresh trade, review or contract scopes after refund and manual reactivation', { skip: !enabled }, async () => {
  const f = await fixture(); assert.equal((await act(f, 'cancel')).status, 200)
  await db.update(schema.listings).set({ status: 'active' }).where(eq(schema.listings.id, f.listing.id))
  const visibility = await import('@/lib/listing-visibility'), { generateJWT: jwt } = await import('@/lib/auth')
  assert.equal(await visibility.originalReviewedContractListing(f.listing.id), true)
  const count = await db.$client.execute({ sql: `SELECT COUNT(*) AS n FROM listings WHERE id=? AND ${visibility.PUBLIC_LISTING_SELLER_WHERE_SQL}`, args: [f.listing.id] })
  assert.equal(Number(count.rows[0].n), 0)
  const catalog = await (await import('@/app/api/listings/route')).GET(new NextRequest(`http://localhost/api/listings?seller_id=${f.seller}&status=active`))
  assert.equal(catalog.status, 200); assert.equal(JSON.stringify(await catalog.json()).includes(f.listing.id), false)
  assert.equal((await (await import('@/lib/public-catalog-snapshot')).getPublicCatalogSnapshot(100)).listings.some(item => item.id === f.listing.id), false)
  const detail = await import('@/app/api/listings/[id]/route'), context = { params: Promise.resolve({ id: f.listing.id }) }
  assert.equal((await detail.GET(new NextRequest(`http://localhost/api/listings/${f.listing.id}`), context)).status, 404)
  const auth = (actor: string) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })}` })
  const update = await detail.PUT(new NextRequest(`http://localhost/api/listings/${f.listing.id}`, { method: 'PUT', headers: auth(f.seller), body: '{"title":"Republished item"}' }), context)
  assert.equal(update.status, 409); assert.equal((await update.json()).code, 'ORIGINAL_CONTRACT_LISTING')
  const preview = await (await import('@/app/api/trades/preview/route')).POST(new NextRequest('http://localhost/api/trades/preview', { method: 'POST', headers: auth(f.other), body: JSON.stringify({ listing_id: f.listing.id }) }))
  assert.equal(preview.status, 409)
  for (const rail of ['credit', 'evm', 'mpp']) {
    const trade = await (await import('@/app/api/trades/route')).POST(new NextRequest('http://localhost/api/trades', { method: 'POST', headers: auth(f.other),
      body: JSON.stringify({ listing_id: f.listing.id, amount: 1, payment_rail: rail, client_reference: crypto.randomUUID() }) }))
    assert.equal(trade.status, 409); assert.equal((await trade.json()).error_code, 'LISTING_NOT_AVAILABLE')
  }
  const [listing] = await db.select().from(schema.listings).where(eq(schema.listings.id, f.listing.id))
  for (const rail of ['credit', 'ledger'] as const) await assert.rejects(db.transaction(tx => (import('@/lib/settlement').then(m => m.createLedgerTrade(tx, listing, f.other, f.feeRecipient, { rail })))),
    (error: unknown) => (error as { code: string }).code === 'ORIGINAL_CONTRACT_LISTING')
  await assert.rejects((await import('@/lib/contract-listing-scope')).requireContractListingScope(db, f.listing.id),
    (error: unknown) => (error as { code: string }).code === 'CONTRACT_LISTING_UNAVAILABLE')
  const drafts = await (await import('@/app/api/contracts/route')).POST(new NextRequest('http://localhost/api/contracts', { method: 'POST', headers: auth(f.other),
    body: JSON.stringify({ listing_id: f.listing.id, client_reference: crypto.randomUUID(), milestones: [{ title: 'Cannot adopt consumed asset', amount: 1 }] }) }))
  assert.equal(drafts.status, 409)
  const reviews = await import('@/lib/organization-listing-authorizations')
  await assert.rejects(reviews.proposeOrganizationListing(f.org, f.owner, reviews.organizationListingInput.parse(f.body)),
    (error: unknown) => (error as { code: string }).code === 'ORGANIZATION_LISTING_NOT_AVAILABLE')
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.listing_id, f.listing.id))).length, 0, 'no new financial family identity is manufactured')
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).available_minor, 100)
  // Even a contradictory mutable contract link cannot detach the original frozen inventory.
  await db.update(schema.contracts).set({ listing_id: null }).where(eq(schema.contracts.id, f.original.contract.id))
  assert.equal(await visibility.originalReviewedContractListing(f.listing.id), true)
  await db.update(schema.contracts).set({ listing_id: f.listing.id }).where(eq(schema.contracts.id, f.original.contract.id))
  assert.equal((await reader.organizationContractExposure(db, f.org, f.buyer)).lifetime, 105)
})

test('contradictory original credit amounts block start, cancel and maintenance before state, listing or financial changes', { skip: !enabled }, async () => {
  const f = await fixture()
  await db.update(schema.contracts).set({ total_amount: 2 }).where(eq(schema.contracts.id, f.original.contract.id))
  const reply = await act(f, 'cancel')
  assert.equal(reply.status, 409); assert.equal((await reply.json()).code, 'ORGANIZATION_CONTRACT_USE_INVALID')
  const { PATCH } = await import('@/app/api/contracts/[id]/route'), { generateJWT: jwt } = await import('@/lib/auth')
  const start = await PATCH(new NextRequest(`http://localhost/api/contracts/${f.original.contract.id}`, { method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt({ userId: f.seller, email: `${f.seller}@test.invalid`, role: 'human' })}` },
    body: JSON.stringify({ action: 'start' }) }), { params: Promise.resolve({ id: f.original.contract.id }) })
  assert.equal(start.status, 409)
  const failed = await maintenance(); assert.equal(failed.status, 409)
  const body = await failed.json(); assert.equal(body.code, 'ORGANIZATION_CONTRACT_USE_INVALID')
  assert.equal(body.success, false); assert.equal(body.financial_changes_committed, false); assert.ok(Date.parse(body.ran_at))
  assert.equal((await db.select().from(schema.contracts).where(eq(schema.contracts.id, f.original.contract.id)))[0].state, 'FUNDED')
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, f.listing.id)))[0].status, 'sold')
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).escrow_minor, 100)
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).available_minor, 0)
})
