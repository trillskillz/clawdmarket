/** CLI fixture for actual HTTP/browser checks; cannot target a deployed database. */
export {}
async function runCapabilityCycleFixture() {
  if (!process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-') || process.env.TURSO_AUTH_TOKEN) throw new Error('Disposable local database required')
  const [mode, raw] = process.argv.slice(2), ids: unknown = JSON.parse(raw || 'null')
  if (!['open', 'close'].includes(mode) || !Array.isArray(ids) || ids.length !== 3 || ids.some((id) => typeof id !== 'string' || !/^agent_[a-f0-9-]{36}$/.test(id))) throw new Error('Three fixture agent IDs required')
  const { db } = await import('../../lib/db'), s = await import('../../lib/schema')
  const { recordCapabilityCompletion } = await import('../../lib/capability-performance')
  const users = ids.map((id) => `user_agent_${id}`)
  try {
    await db.insert(s.users).values(users.map((id) => ({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'agent' as const }))).onConflictDoNothing()
    const complete = async (buyer: number, seller: number) => {
      const sellerId = users[seller], buyerId = users[buyer]
      const [listing] = await db.insert(s.listings).values({ seller_id: sellerId, category: 'skills', title: 'Browser cycle fixture', description: 'Controlled local completion fixture.', price_bankr: 1, status: 'sold' }).returning()
      const [service] = await db.insert(s.service_definitions).values({ id: crypto.randomUUID(), seller_id: sellerId, title: 'Browser cycle fixture', description: 'Controlled local completion fixture.', capabilities: '["code-review"]', price_minor: 100, status: 'active' }).returning()
      const [trade] = await db.insert(s.trades).values({ listing_id: listing.id, buyer_id: buyerId, seller_id: sellerId, amount: 1, fee: 0.05, total_cost: 1.05, seller_amount: 1, status: 'completed', payment_rail: 'ledger' }).returning()
      await db.insert(s.service_orders).values({ id: crypto.randomUUID(), service_id: service.id, listing_id: listing.id, trade_id: trade.id, buyer_id: buyerId, client_reference: crypto.randomUUID(), objective: 'Controlled local completion fixture', price_minor: 100, payment_rail: 'ledger', state: 'completed' })
      const [delivery] = await db.insert(s.trade_deliveries).values({ trade_id: trade.id, submitter_id: sellerId, summary: 'Controlled local completion fixture.', content_hash: crypto.randomUUID(), verification: '{}' }).returning()
      await db.insert(s.verification_results).values({ id: crypto.randomUUID(), trade_id: trade.id, delivery_id: delivery.id, content_hash: delivery.content_hash, method: 'buyer_review', verifier: 'buyer', version: '1', status: 'passed', evidence_json: '{}' })
      await db.insert(s.transactions).values([{ type: 'escrow_lock', amount: 1, reference_id: trade.id }, { type: 'escrow_release', amount: 1, reference_id: trade.id }])
      await db.transaction((tx) => recordCapabilityCompletion(tx, trade))
      return trade.id
    }
    const trades = mode === 'open' ? [await complete(0, 1), await complete(1, 2)] : [await complete(2, 0)]
    process.stdout.write(JSON.stringify({ trade_ids: trades, settled: true }))
  } finally { db.$client.close() }
}
runCapabilityCycleFixture().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
