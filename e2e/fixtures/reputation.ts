/** Controlled browser data only; never accepts a deployed database. */
export {}
async function run() {
  if (!process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-') || process.env.TURSO_AUTH_TOKEN) throw new Error('Disposable local database required')
  const [mode, raw] = process.argv.slice(2)
  const { db } = await import('../../lib/db'), s = await import('../../lib/schema')
  const { and, eq } = await import('drizzle-orm')
  try {
    if (mode === 'seed') {
      const good = `agent_${crypto.randomUUID()}`, fake = `agent_${crypto.randomUUID()}`, alias = `agent_${crypto.randomUUID()}`, buyer = `reputation-browser-${crypto.randomUUID()}`, tag = `reputation${crypto.randomUUID().replaceAll('-', '')}`
      for (const [index, id] of [good, fake, alias].entries()) {
        await db.insert(s.agents).values({ id, name: `${tag}${index}`, description: 'Controlled local reputation fixture', capabilities: '["code-review"]', endpoint: '', owner_address: `0x${'11'.repeat(20)}`, api_key: `unused-${id}` })
        await db.insert(s.users).values({ id: `user_agent_${id}`, name: `${tag}${index}`, email: `${id}@test.invalid`, password_hash: 'unused', role: 'agent' })
      }
      await db.insert(s.users).values({ id: buyer, name: 'Local buyer', email: `${buyer}@test.invalid`, password_hash: 'unused', role: 'human' })
      await db.insert(s.agent_owners).values({ agentId: alias, userId: buyer, establishedBy: 'test' })
      const trades = []
      for (const [seller, purchaser, score, backed] of [[good, buyer, 4, true], [good, `user_agent_${alias}`, 2, true], [fake, buyer, 5, false]] as const) {
        const sellerId = `user_agent_${seller}`
        const [listing] = await db.insert(s.listings).values({ seller_id: sellerId, title: tag, description: 'Controlled local reputation fixture', category: 'skills', price_bankr: 1, status: 'sold' }).returning()
        const [trade] = await db.insert(s.trades).values({ listing_id: listing.id, buyer_id: purchaser, seller_id: sellerId, amount: 1, fee: 0.05, total_cost: 1.05, payment_rail: 'ledger', status: 'completed' }).returning()
        const [delivery] = await db.insert(s.trade_deliveries).values({ trade_id: trade.id, submitter_id: sellerId, summary: 'Accepted local fixture', content_hash: crypto.randomUUID(), verification: '{}' }).returning()
        await db.insert(s.verification_results).values({ id: crypto.randomUUID(), trade_id: trade.id, delivery_id: delivery.id, content_hash: delivery.content_hash, method: 'buyer_review', verifier: 'buyer', version: '1', status: 'passed', evidence_json: '{}' })
        if (backed) await db.insert(s.transactions).values([{ type: 'escrow_lock', reference_id: trade.id, from_user_id: purchaser, amount: 1 }, { type: 'escrow_release', reference_id: trade.id, from_user_id: purchaser, to_user_id: sellerId, amount: 1 }])
        await db.insert(s.ratings).values({ id: crypto.randomUUID(), trade_id: trade.id, rater_id: purchaser, rated_id: sellerId, score, created_at: new Date(Date.now() - (score === 4 ? 20000 : 10000)).toISOString() })
        if (backed) trades.push(trade.id)
      }
      for (const seller of [good, fake]) await db.insert(s.listings).values({ seller_id: `user_agent_${seller}`, title: tag, description: 'Controlled local reputation fixture', category: 'skills', price_bankr: 1, status: 'active' })
      process.stdout.write(JSON.stringify({ good, fake, alias, buyer, tag, trades, name: `${tag}0` }))
    } else {
      const state = JSON.parse(raw || 'null')
      if (!state || !/^agent_[a-f0-9-]{36}$/.test(state.alias) || !Array.isArray(state.trades) || state.trades.some((id: unknown) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))) throw new Error('Fixture state required')
      if (mode === 'unlink') await db.delete(s.agent_owners).where(eq(s.agent_owners.agentId, state.alias))
      else if (mode === 'invalidate') for (const id of state.trades) await db.delete(s.transactions).where(and(eq(s.transactions.reference_id, id), eq(s.transactions.type, 'escrow_release')))
      else throw new Error('Unknown fixture action')
    }
  } finally { db.$client.close() }
}
run().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
