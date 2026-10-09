/** Local owner fixtures; never target a deployed database or configured wallet. */
export {}
async function main() {
  if (!process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-') || process.env.TURSO_AUTH_TOKEN) throw Error('Disposable local database required')
  const [mode, agentId] = process.argv.slice(2)
  if (!['owners', 'counts', 'transfer', 'service', 'purchasing-policy', 'private-service', 'publish-provider'].includes(mode) || !/^agent_[a-f0-9-]{36}$/.test(agentId || '')) throw Error('Fixture mode/agent required')
  const { db } = await import('../../lib/db'), s = await import('../../lib/schema'), { eq } = await import('drizzle-orm')
  const owner = `workflow-owner-${agentId}`, outsider = `workflow-outsider-${agentId}`, buyer = `user_agent_${agentId}`
  try {
    if (mode === 'owners') {
      await db.insert(s.users).values([owner, outsider].map((id) => ({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused' })))
      await db.insert(s.agent_owners).values({ agentId, userId: owner, establishedBy: 'isolated-browser' })
      const { generateJWT } = await import('../../lib/auth')
      console.log(JSON.stringify({ owner_key: generateJWT({ userId: owner, email: `${owner}@test.invalid`, role: 'human' }), outsider_key: generateJWT({ userId: outsider, email: `${outsider}@test.invalid`, role: 'human' }) }))
    } else if (mode === 'publish-provider') {
      await db.update(s.agents).set({visibility:'public'}).where(eq(s.agents.id,agentId))
      console.log(JSON.stringify({published:true}))
    } else if (mode === 'private-service') {
      const providerAgent=`agent_${crypto.randomUUID()}`,providerOwner=`private-provider-owner-${providerAgent}`,seller=`user_agent_${providerAgent}`
      const {hashAgentApiKey}=await import('../../lib/registered-agent-auth'),{generateJWT}=await import('../../lib/auth')
      const providerKey=`clawdmarket-test-private-${providerAgent}`
      await db.insert(s.users).values([providerOwner,seller].map(id=>({id,name:id,email:`${id}@test.invalid`,password_hash:'unused'})))
      await db.insert(s.agents).values({id:providerAgent,name:'Private browser provider',description:'Confidential organization work',capabilities:'["code-review"]',endpoint:'https://example.invalid',owner_address:'',visibility:'private',api_key:hashAgentApiKey(providerKey)})
      await db.insert(s.agent_owners).values({agentId:providerAgent,userId:providerOwner,establishedBy:'isolated-browser'})
      await db.insert(s.payout_addresses).values({user_id:seller,address:`0x${'22'.repeat(20)}`})
      console.log(JSON.stringify({providerAgent,providerKey,providerOwnerKey:generateJWT({userId:providerOwner,email:`${providerOwner}@test.invalid`,role:'human'})}))
    } else if (mode === 'service') {
      const seller = `workflow-seller-${agentId}`, service = crypto.randomUUID()
      await db.insert(s.users).values({ id: seller, name: seller, email: `${seller}@test.invalid`, password_hash: 'unused' })
      await db.insert(s.payout_addresses).values({ user_id: seller, address: `0x${'22'.repeat(20)}` })
      await db.insert(s.service_definitions).values({ id: service, seller_id: seller, title: 'Private workflow HTTP fixture',
        description: 'Review the exact private repository.', capabilities: '["code-review"]', price_minor: 95,
        estimated_latency_seconds: 30, max_concurrency: 2, status: 'active',
        verification_policy: JSON.stringify({ required: true, methods: ['buyer_review'], acceptance: { version: 1, mode: 'explicit_buyer' } }) })
      console.log(JSON.stringify({ seller, service }))
    } else if (mode === 'purchasing-policy') {
      const now = new Date()
      await db.insert(s.buyer_spend_policies).values({ buyer_id: buyer, owner_account_id: owner, policy_json: '{"approval_required_above":50}', version: 1, created_at: now, updated_at: now })
      console.log(JSON.stringify({ configured: true }))
    } else if (mode === 'transfer') {
      await db.update(s.agent_owners).set({ userId: outsider }).where(eq(s.agent_owners.agentId, agentId))
      console.log(JSON.stringify({ transferred: true }))
    } else {
      const approvals = await db.select().from(s.workflow_approvals).where(eq(s.workflow_approvals.buyer_id, buyer))
      const orders = await db.select().from(s.service_orders).where(eq(s.service_orders.buyer_id, buyer))
      const trades = await db.select().from(s.trades).where(eq(s.trades.buyer_id, buyer))
      console.log(JSON.stringify({ approvals: approvals.length, orders: orders.length, trades: trades.length }))
    }
  } finally { db.$client.close() }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
