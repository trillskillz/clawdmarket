/** Stored timeline fixtures only; no financial endpoints or configured wallets are touched. */
import { createLocalTestSchema } from '../../tests/helpers/local-schema'
async function main() {
  if (!process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-') || process.env.TURSO_AUTH_TOKEN || process.env.VERCEL || process.env.VERCEL_ENV) throw Error('Disposable activity database required')
  const { db } = await import('../../lib/db'), schema = await import('../../lib/schema')
  try {
    await createLocalTestSchema(db.$client, schema)
    const id = `observe-fixture-${crypto.randomUUID()}`, second = Math.floor(Date.now() / 1000)
    await db.insert(schema.users).values({ id, email: `${id}@test.invalid`, password_hash: 'unused', name: 'Private Observe Account', created_at: new Date((second - 10) * 1000) })
    const seller = `${id}-seller`
    await db.insert(schema.users).values({ id: seller, email: `${seller}@test.invalid`, password_hash: 'unused', name: 'Observe Seller', role: 'agent' })
    await db.insert(schema.payout_addresses).values({ user_id: seller, address: `0x${'44'.repeat(20)}` })
    await db.insert(schema.listings).values({ id, seller_id: seller, title: 'Observe timeline', description: '', category: 'other', price_bankr: 2 })
    await db.insert(schema.trades).values({ id, listing_id: id, buyer_id: id, seller_id: seller, amount: 2, fee: 0, status: 'completed', created_at: new Date((second - 8) * 1000), completed_at: new Date((second - 4) * 1000) })
    await db.insert(schema.payment_receipts).values({ id, route: '/api/trades/fund', trade_id: id, amount: 2, currency: 'USDC', created_at: new Date((second - 6) * 1000) })
    await db.insert(schema.settlement_transfers).values({ id, business_key: id, trade_id: id, kind: 'buyer_refund', chain_id: 1, token_address: 'fixture-token', from_address: 'fixture-from', to_address: 'fixture-to', token_amount: '2000000', usd_amount: 2, tx_hash: 'fixture-hash', status: 'confirmed', created_at: new Date((second - 7) * 1000), confirmed_at: new Date((second - 2) * 1000) })
    await db.insert(schema.credit_entries).values({ id, user_id: id, reference: 'fixture-private-deposit', kind: 'deposit', available_delta: 900, escrow_delta: 0, created_at: new Date(second * 1000) })
    const token = (await import('../../lib/auth')).generateJWT({ userId: id, email: `${id}@test.invalid`, role: 'human' })
    console.log(JSON.stringify({ id, token }))
  } finally { db.$client.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
