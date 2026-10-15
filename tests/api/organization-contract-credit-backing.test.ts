import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { createWalletClient, erc20Abi, http } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
import { reviewedContractFixture } from '../helpers/reviewed-contract-fixture'
import { startDisposableWorkflowChain } from '../helpers/disposable-workflow-chain'
import { creditDepositMessage } from '@/lib/credit-proof'

test('actual unforked Base-ID token deposit backs original credit once and cannot bypass a contract review companion', {
  skip: !process.env.CLAWDMARKET_TEST_ANVIL_BINARY, timeout: 60000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-contract-credit-backing-'))
  const payer = privateKeyToAccount(`0x${'18'.repeat(32)}`), treasuryKey = `0x${'99'.repeat(32)}` as const
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'backing.db')}`, TURSO_AUTH_TOKEN: '',
    JWT_SECRET: 'contract-credit-backing-public-fixture-only', AGENT_API_KEY_PEPPER: 'contract-credit-backing-public-fixture-only',
    WEBHOOK_SECRET_KEY: 'contract-credit-backing-public-fixture-only', CHAT_ENCRYPTION_KEY: 'contract-credit-backing-public-fixture-only',
    CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true' })
  for (const name of ['VERCEL', 'VERCEL_ENV', 'CLAWDMARKET_NEW_PAYMENTS_PAUSED', 'DEV_WALLET_ADDRESS', 'DEV_FEE_WALLET_ADDRESS']) delete process.env[name]
  const chain = await startDisposableWorkflowChain(process.env.CLAWDMARKET_TEST_ANVIL_BINARY!, payer.address, treasuryKey, 8453)
  let database: typeof import('@/lib/db').db | undefined
  try {
    Object.assign(process.env, { TREASURY_ADDRESS: chain.treasury, EVM_SETTLEMENT_PRIVATE_KEY: treasuryKey,
      EVM_ACCEPTED_TOKENS: JSON.stringify([{ chainId: 8453, chainName: 'Disposable unforked credit backing', address: chain.token,
        symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 1, rpcUrl: chain.url }]),
    })
    const db = (await import('@/lib/db')).db, schema = await import('@/lib/schema'); database = db
    await createLocalTestSchema(db.$client, schema)
    const f = await reviewedContractFixture({ db, schema }), { generateJWT } = await import('@/lib/auth')
    const request = (path: string, method: string, body: unknown) => new NextRequest(`http://localhost${path}`, { method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${generateJWT({ userId: f.buyer, email: `${f.buyer}@test.invalid`, role: 'human' })}` }, body: JSON.stringify(body) })
    const deposits = await import('@/app/api/wallet/deposits/route'), credit = await import('@/lib/account-credit')
    const input = { amount_minor: 105, payer: payer.address, client_reference: crypto.randomUUID() }
    const created = await deposits.POST(request('/api/wallet/deposits', 'POST', input))
    assert.equal(created.status, 200, JSON.stringify(await created.clone().json()))
    const original = (await created.json()).deposit
    assert.equal((await credit.creditBalance(f.buyer)).available_minor, 0, 'an intent is not a deposit')
    const beforeBuyer = await chain.balance(payer.address), beforeTreasury = await chain.balance(chain.treasury)
    const wallet = createWalletClient({ chain: { ...mainnet, id: 8453 }, transport: http(chain.url), account: payer })
    const hash = await wallet.writeContract({ address: chain.token, abi: erc20Abi, functionName: 'transfer', args: [chain.treasury, 1_050_000n] })
    const receipt = await chain.client.waitForTransactionReceipt({ hash })
    assert.equal(receipt.status, 'success')
    const signature = await payer.signMessage({ message: creditDepositMessage(original, hash) })
    const proof = { id: original.id, tx_hash: hash, signature }
    for (let replay = 0; replay < 2; replay++) {
      const confirmed = await deposits.PUT(request('/api/wallet/deposits', 'PUT', proof))
      assert.equal(confirmed.status, 200, JSON.stringify(await confirmed.clone().json()))
      assert.equal((await confirmed.json()).deposit.id, original.id)
    }
    assert.equal(beforeBuyer - await chain.balance(payer.address), 1_050_000n)
    assert.equal(await chain.balance(chain.treasury) - beforeTreasury, 1_050_000n)
    assert.equal((await credit.creditBalance(f.buyer)).available_minor, 105)
    const entries = await db.select().from(schema.credit_entries).where(eq(schema.credit_entries.user_id, f.buyer))
    assert.equal(entries.length, 1); assert.equal(entries[0].kind, 'deposit'); assert.equal(entries[0].reference, original.id)
    const saved = await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.tx_hash, hash))
    assert.equal(saved.length, 1); assert.equal(saved[0].token_amount, '1050000')
    const domain = await import('@/lib/organization-contract-authorizations')
    const a = await domain.proposeOrganizationContract(f.org, f.owner, domain.organizationContractInput.parse(f.input))
    await domain.approveOrganizationContract(f.org, a.authorization.id, f.reviewer, { version: 1,
      client_reference: crypto.randomUUID(), authority_hash: a.authorization.authority_hash, approve: true })
    const { PATCH } = await import('@/app/api/contracts/[id]/route')
    const blocked = await PATCH(request(`/api/contracts/${f.original.contract.id}`, 'PATCH', { action: 'fund' }), { params: Promise.resolve({ id: f.original.contract.id }) })
    assert.equal(blocked.status, 409); assert.equal((await blocked.json()).code, 'CONTRACT_REVIEWED_FUNDING_REQUIRED')
    assert.equal((await credit.creditBalance(f.buyer)).available_minor, 105); assert.equal((await credit.creditBalance(f.buyer)).escrow_minor, 0)
    assert.equal((await db.select().from(schema.contracts).where(eq(schema.contracts.id, f.original.contract.id)))[0].state, 'DRAFT')
    console.info(JSON.stringify({ original_contract_credit_backing: 'passed', actual_disposable_deposit_minor: 105,
      original_deposit_confirmation_requests: 2, receipt_confirmations_required: 1, credit_deposit_postings: 1, contract_funding_implemented: false,
      live_funds: false, independent_activity: false }))
  } finally { database?.$client.close(); await chain.stop(); await rm(directory, { recursive: true, force: true }) }
})
