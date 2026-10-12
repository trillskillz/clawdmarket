import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let activity: typeof import('@/app/api/activity/route').GET
let wallet: typeof import('@/app/api/wallet/activity/route').GET
let token: string
const date = '2026-10-11T12:00:00.000Z'

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-observe-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'activity.db')}`
  process.env.TURSO_AUTH_TOKEN = ''
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  activity = (await import('@/app/api/activity/route')).GET
  wallet = (await import('@/app/api/wallet/activity/route')).GET
  await db.insert(schema.users).values([
    { id: 'member-private-id', email: 'private-email@test.invalid', password_hash: 'secret-hash', name: 'Private Human Name', role: 'human', created_at: new Date(date) },
    { id: 'other-member', email: 'other@test.invalid', password_hash: 'unused', name: 'Other Member', created_at: new Date(date) },
    { id: 'banned-member', email: 'banned@test.invalid', password_hash: 'unused', name: 'Banned Member', is_banned: true, created_at: new Date(date) },
    { id: 'user_agent_public', email: 'synthetic@test.invalid', password_hash: 'unused', name: 'Public Provider', role: 'agent', created_at: new Date(date) },
    { id: 'user_agent_private', email: 'private@test.invalid', password_hash: 'unused', name: 'Private Provider', role: 'agent', created_at: new Date(date) },
  ])
  await db.insert(schema.agents).values(['public', 'private'].map(id => ({ id, name: `${id} provider`, description: '', capabilities: '[]', endpoint: '', owner_address: 'SECRET-OWNER', api_key: `SECRET-KEY-${id}`, visibility: id as 'public' | 'private', created_at: new Date('2026-10-11T11:00:00Z') })))
  await db.insert(schema.listings).values({ id: 'listing', seller_id: 'user_agent_public', category: 'analysis', title: 'Service', description: '', price_bankr: 1 })
  await db.insert(schema.trades).values([
    { id: 'public-trade', listing_id: 'listing', buyer_id: 'member-private-id', seller_id: 'user_agent_public', amount: 3, fee: 0, status: 'completed', created_at: new Date('2026-10-11T09:00:00Z'), completed_at: new Date('2026-10-11T12:03:00Z') },
    { id: 'legacy-completed', listing_id: 'listing', buyer_id: 'member-private-id', seller_id: 'user_agent_public', amount: 3, fee: 0, status: 'completed', created_at: new Date('2026-10-11T08:00:00Z') },
    { id: 'private-trade', listing_id: 'listing', buyer_id: 'member-private-id', seller_id: 'user_agent_private', amount: 3, fee: 0, created_at: new Date(date) },
  ])
  await db.insert(schema.payment_receipts).values([
    { id: 'public-proof', route: '/api/trades/fund', trade_id: 'public-trade', amount: 3, currency: 'USDC', payment_rail: 'evm', tx_hash: 'SECRET-TX-PUBLIC', payer_address: 'SECRET-PAYER', created_at: new Date('2026-10-11T12:01:00Z') },
    { id: 'private-proof', route: '/api/trades/fund', trade_id: 'private-trade', amount: 3, currency: 'USDC', created_at: new Date('2026-10-11T12:09:00Z') },
    { id: 'platform-proof', route: '/api/mcp', payment_rail: 'mpp', amount: .001, currency: 'pathUSD', chain_id: 4217, token_address: '0x20c0000000000000000000000000000000000000', tx_hash: `0x${'ab'.repeat(32)}`, created_at: new Date('2026-10-11T12:02:30Z') },
    { id: 'private-platform-proof', route: '/api/wallet/deposits', payment_rail: 'mpp', amount: .001, currency: 'pathUSD', chain_id: 4217, token_address: '0x20c0000000000000000000000000000000000000', tx_hash: `0x${'ac'.repeat(32)}`, created_at: new Date('2026-10-11T12:09:30Z') },
    { id: 'wrong-chain-platform-proof', route: '/api/mcp', payment_rail: 'mpp', amount: .001, currency: 'pathUSD', chain_id: 1, token_address: '0x20c0000000000000000000000000000000000000', tx_hash: `0x${'ad'.repeat(32)}`, created_at: new Date('2026-10-11T12:09:30Z') },
    { id: 'deposit-proof', route: '/api/wallet/deposits', amount: 9, currency: 'USDC', external_id: 'private-deposit', created_at: new Date('2026-10-11T12:08:00Z') },
  ])
  await db.insert(schema.settlement_transfers).values(['public-transfer', 'pending-transfer', 'private-transfer'].map(id => ({
    id, business_key: id, trade_id: id === 'private-transfer' ? 'private-trade' : 'public-trade', kind: 'buyer_refund' as const,
    chain_id: 1, token_address: 'SECRET-TOKEN', from_address: 'SECRET-FROM', to_address: 'SECRET-TO', token_amount: '3000000', usd_amount: 3,
    raw_transaction: 'SECRET-BYTES', tx_hash: `SECRET-HASH-${id}`, status: id === 'pending-transfer' ? 'submitted' as const : 'confirmed' as const,
    created_at: new Date('2026-10-11T09:00:00Z'), confirmed_at: id === 'pending-transfer' ? null : new Date('2026-10-11T12:04:00Z'),
  })))
  await db.insert(schema.credit_entries).values([
    { id: 'own-deposit', user_id: 'member-private-id', reference: 'private-deposit', kind: 'deposit', available_delta: 900, escrow_delta: 0, created_at: new Date('2026-10-11T12:08:00Z') },
    { id: 'other-credit', user_id: 'other-member', reference: 'OTHER-PRIVATE-REFERENCE', kind: 'deposit', available_delta: 400, escrow_delta: 0, created_at: new Date('2026-10-11T12:09:00Z') },
  ])
  token = (await import('@/lib/auth')).generateJWT({ userId: 'member-private-id', email: 'private-email@test.invalid', role: 'human' })
})

after(() => { db?.$client.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })

test('human registrations, public payment proofs and confirmed transfers share descending actual event dates without private data', async () => {
  const response = await activity()
  assert.equal(response.status, 200)
  const events = await response.json()
  assert.equal(events.every((event: any, index: number) => !index || Date.parse(events[index - 1].timestamp) >= Date.parse(event.timestamp)), true)
  assert.equal(events[0].id, 'wallet_settlement_public-transfer')
  assert.equal(events[0].timestamp, '2026-10-11T12:04:00.000Z')
  assert.equal(events.find((e: any) => e.id === 'trade_public-trade_trade_completed').timestamp, '2026-10-11T12:03:00.000Z')
  assert.equal(events.find((e: any) => e.id === 'wallet_payment_public-proof').timestamp, '2026-10-11T12:01:00.000Z')
  assert.equal(events.filter((e: any) => e.type === 'account_registered').length, 2)
  const legacy = events.find((e: any) => e.id === 'trade_legacy-completed_trade_completed')
  assert.equal(legacy.timestamp, '2026-10-11T08:00:00.000Z')
  assert.match(legacy.description, /trade creation date/)
  const platform = events.find((e: any) => e.id === `wallet_payment_platform_0x${'ab'.repeat(32)}`)
  assert.equal(platform.timestamp, '2026-10-11T12:02:30.000Z')
  assert.equal(platform.description, 'Platform payment confirmed: 0.001 pathUSD (MPP on Tempo)')
  assert.equal(events.some((e: any) => e.id === `wallet_payment_platform_0x${'ac'.repeat(32)}`), false)
  assert.equal(events.some((e: any) => e.id === `wallet_payment_platform_0x${'ad'.repeat(32)}`), false)
  const text = JSON.stringify(events)
  for (const secret of ['SECRET-', 'private-trade', 'private-proof', 'private-transfer', 'pending-transfer', 'deposit-proof', 'member-private-id', 'Private Human Name', 'private-email', 'secret-hash', 'banned-member', 'own-deposit', 'other-credit']) assert.equal(text.includes(secret), false, secret)
})

test('personal wallet activity requires the caller identity and uses ledger posting/transfer confirmation dates', async () => {
  const anonymous = await wallet(new NextRequest('https://test.invalid/api/wallet/activity?user_id=member-private-id'))
  assert.deepEqual(await anonymous.json(), { events: [] })
  const response = await wallet(new NextRequest('https://test.invalid/api/wallet/activity?user_id=other-member', { headers: { authorization: `Bearer ${token}` } }))
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control')!, /private, no-store/)
  assert.equal(response.headers.get('vary'), 'Cookie, Authorization')
  const { events } = await response.json()
  assert.equal(events[0].id, 'wallet_credit_own-deposit')
  assert.equal(events[0].timestamp, '2026-10-11T12:08:00.000Z')
  assert.match(events[0].description, /Wallet deposit credited: available \+\$9\.00/)
  assert.equal(events.every((e: any) => e.personal), true)
  assert.equal(events.some((e: any) => e.id === 'wallet_settlement_private-transfer'), true)
  for (const secret of ['SECRET-', 'OTHER-PRIVATE-REFERENCE', 'other-credit', 'private-email', 'private-deposit', 'pending-transfer']) assert.equal(JSON.stringify(events).includes(secret), false, secret)
})

test('numeric strings, milliseconds, seconds, UTC SQLite dates and ISO offsets retain global millisecond order before source truncation', async () => {
  const base = Date.parse('2026-10-11T13:00:00.000Z')
  for (let index = 0; index < 80; index++) {
    const milliseconds = base + index * 1000 + (index % 3)
    const timestamp = index % 5 === 0 ? milliseconds : index % 5 === 1 ? String(milliseconds)
      : index % 5 === 2 ? Math.floor(milliseconds / 1000) : index % 5 === 3 ? new Date(milliseconds).toISOString().replace('T', ' ').replace('Z', '')
        : new Date(milliseconds).toISOString().replace('Z', '+00:00')
    await db.$client.execute({ sql: `INSERT INTO agents (id,name,description,capabilities,endpoint,owner_address,api_key,created_at) VALUES (?,?, '', '[]', '', '', ?, ?)`, args: [`mixed-${index}`, `Mixed ${index}`, `key-${index}`, timestamp] })
  }
  const events = await (await activity()).json()
  assert.equal(events.length, 50)
  assert.deepEqual(events.map((e: any) => e.id), Array.from({ length: 50 }, (_, index) => `registration_mixed-${79 - index}`))
  assert.equal(events.find((e: any) => e.id === 'registration_mixed-78').timestamp, '2026-10-11T13:01:18.000Z')
  assert.equal(events.find((e: any) => e.id === 'registration_mixed-79').timestamp, '2026-10-11T13:01:19.001Z')
  assert.equal(events.find((e: any) => e.id === 'registration_mixed-76').timestamp, '2026-10-11T13:01:16.001Z')
})

test('public activity and profiles no longer depend on legacy improvement storage', async () => {
  await db.$client.execute('DROP TABLE agent_improvements')
  assert.equal((await activity()).status, 200)
  const profile = await (await import('@/app/api/agents/[id]/route')).GET(new NextRequest('https://clawdmkt.test/api/agents/public'), { params: Promise.resolve({ id: 'public' }) })
  assert.equal(profile.status, 200)
  const body = await profile.json()
  assert.equal('improvements' in body, false)
  assert.equal('velocity_score' in body, false)
})

test('a failed source returns unavailable rather than a misleading successful partial timeline', async () => {
  await db.$client.execute('DROP TABLE ratings')
  const response = await activity()
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'Activity temporarily unavailable' })
  assert.equal(response.headers.get('cache-control'), 'no-store')
})
