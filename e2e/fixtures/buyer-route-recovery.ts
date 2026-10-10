/** Seed only disposable buyer UI identities/services; economic changes use actual HTTP. */
export {}
async function main() {
  if (!process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-') || process.env.TURSO_AUTH_TOKEN) throw Error('Disposable database required')
  const [mode, id] = process.argv.slice(2)
  if (!['setup','counts','evidence','bump','link-agent'].includes(mode) || !/^[a-f0-9-]{36}$/.test(id || '')) throw Error('Guarded fixture required')
  const { db } = await import('../../lib/db'), schema = await import('../../lib/schema'), { eq } = await import('drizzle-orm')
  const buyer = `route-ui-buyer-${id}`, seller = `route-ui-seller-${id}`, outsider = `route-ui-outsider-${id}`
  try {
    if (mode === 'setup') {
      await db.insert(schema.users).values([buyer,seller,outsider].map(user => ({ id: user, name: user, email: `${user}@test.invalid`, password_hash: 'unused', role: 'human' as const })))
      await db.insert(schema.payout_addresses).values({ user_id: seller, address: `0x${'22'.repeat(20)}` })
      const services = [crypto.randomUUID(),crypto.randomUUID()]
      for (const service of services) await db.insert(schema.service_definitions).values({ id: service, seller_id: seller, title: 'Original route UI review',
        description: 'Review the original private input.', capabilities: '["code-review"]', price_minor: 95, estimated_latency_seconds: 30,
        max_concurrency: 10, status: 'active', verification_policy: JSON.stringify({ required: true, methods: ['buyer_review'], acceptance: { version: 1, mode: 'explicit_buyer' } }) })
      const { generateJWT } = await import('../../lib/auth')
      const key = (user: string) => generateJWT({ userId: user, email: `${user}@test.invalid`, role: 'human' })
      console.log(JSON.stringify({ buyer, seller, services, buyerKey: key(buyer), sellerKey: key(seller), outsiderKey: key(outsider) }))
    } else if (mode === 'counts') {
      const orders = await db.select().from(schema.service_orders).where(eq(schema.service_orders.buyer_id,buyer))
      const trades = await db.select().from(schema.trades).where(eq(schema.trades.buyer_id,buyer))
      const services = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.seller_id,seller))
      console.log(JSON.stringify({ orders: orders.length, trades: trades.length, capacity: services.reduce((sum,row)=>sum+row.active_orders,0) }))
    } else if (mode === 'evidence') {
      const trades = await db.select().from(schema.trades).where(eq(schema.trades.buyer_id,buyer))
      const transfers = [], receipts = []
      for (const trade of trades) {
        transfers.push(...await db.select({id:schema.settlement_transfers.id,status:schema.settlement_transfers.status,kind:schema.settlement_transfers.kind,tx_hash:schema.settlement_transfers.tx_hash}).from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id,trade.id)))
        receipts.push(...await db.select({route_id:schema.route_receipts.route_id,content_hash:schema.route_receipts.content_hash}).from(schema.route_receipts).where(eq(schema.route_receipts.trade_id,trade.id)))
      }
      console.log(JSON.stringify({transfers,receipts}))
    } else if (mode === 'link-agent') {
      const agentId = process.argv[4]
      if (!/^agent_[a-f0-9-]{36}$/.test(agentId || '')) throw Error('Original UI agent required')
      const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id,agentId))
      if (!agent?.name.startsWith('Route UI owned agent')) throw Error('Original UI agent required')
      await db.insert(schema.agent_owners).values({agentId,userId:buyer,establishedBy:'disposable-route-ui'})
      console.log(JSON.stringify({linked:true}))
    } else {
      const serviceId = process.argv[4]
      if (!/^[a-f0-9-]{36}$/.test(serviceId || '')) throw Error('Original service required')
      const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id,serviceId))
      if (service?.seller_id !== seller) throw Error('Original UI seller required')
      await db.update(schema.service_definitions).set({ price_minor: 96 }).where(eq(schema.service_definitions.id,serviceId))
      console.log(JSON.stringify({ changed: true }))
    }
  } finally { db.$client.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
