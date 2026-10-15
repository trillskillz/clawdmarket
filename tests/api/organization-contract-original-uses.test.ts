import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
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
  domain = await import('@/lib/organization-contract-authorizations'); reader = await import('@/lib/organization-contract-uses')
})
after(async () => { db?.$client.close(); if (chain) await chain.stop(); if (directory) await rm(directory, { recursive: true, force: true }) })

async function fixture() {
  const f = await reviewedContractFixture({ db, schema }), credit = await import('@/lib/account-credit')
  const deposit = await credit.createDeposit(f.buyer, { amount_minor: 105, payer: payer.address, client_reference: crypto.randomUUID() })
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
  })
  return { ...f, a, feeRecipient, funding }
}
const invalid = (error: unknown) => (error as { code?: string }).code === 'ORGANIZATION_CONTRACT_USE_INVALID'

test('original contract use validates exact real-deposit-backed reservation and charges gross once without any chain fee unit', { skip: !enabled }, async () => {
  const f = await fixture(), original = await reader.originalReviewedContractUse(db, f.original.contract.id)
  assert.equal(original?.remaining_principal_minor, 100)
  assert.equal(original?.use.fee_recipient_id, f.feeRecipient)
  assert.deepEqual(await reader.organizationContractExposure(db, f.org, f.buyer), { daily: 105, monthly: 105, lifetime: 105, gas: 0n, fees: 0n })
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
