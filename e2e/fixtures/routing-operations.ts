/** Guarded disposable browser fixtures. No deployed database or wallet access. */
export {}
async function main() {
  if (!process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-') || process.env.TURSO_AUTH_TOKEN) throw Error('Disposable local database required')
  const [mode, id] = process.argv.slice(2)
  if (!['seed', 'uncertain', 'repair', 'enterprise', 'enterprise_uncertain', 'enterprise_repair'].includes(mode)) throw Error('Unknown fixture mode')
  const { db } = await import('../../lib/db'), schema = await import('../../lib/schema')
  const { eq } = await import('drizzle-orm')
  try {
    if (mode === 'seed') {
      const admin = 'benchmark-browser-admin', viewer = `routing-viewer-${crypto.randomUUID()}`
      if (!(process.env.ADMIN_USER_IDS || admin).split(',').includes(admin)) throw Error('Local browser administrator required')
      await db.insert(schema.users).values([admin, viewer].map(user => ({ id: user, name: user, email: `${user}@test.invalid`, password_hash: 'unused' }))).onConflictDoNothing()
      const { generateJWT } = await import('../../lib/auth')
      console.log(JSON.stringify({ admin: generateJWT({ userId: admin, email: `${admin}@test.invalid`, role: 'human' }),
        viewer: generateJWT({ userId: viewer, email: `${viewer}@test.invalid`, role: 'human' }), viewerId: viewer }))
    } else if(mode==='enterprise'){
      if(!/^routing-viewer-[a-f0-9-]{36}$/.test(id||''))throw Error('Original browser fixture owner required')
      const organization=crypto.randomUUID(),agent=crypto.randomUUID(),service=crypto.randomUUID()
      await db.insert(schema.agents).values({id:agent,name:'Operator enterprise fixture',description:'Disposable owner-reviewed spending inventory',capabilities:'["code-review"]',endpoint:'https://example.invalid',owner_address:'',api_key:'a'.repeat(64)})
      await db.insert(schema.agent_owners).values({agentId:agent,userId:id,establishedBy:'test'})
      await db.insert(schema.organizations).values({id:organization,owner_account_id:id,client_reference:organization,name:'Disposable enterprise audit',created_at:new Date(),updated_at:new Date()})
      await db.insert(schema.organization_agent_assignments).values({agent_id:agent,organization_id:organization,cost_center:'OPERATOR_FIXTURE',assigned_at:new Date(),updated_at:new Date()})
      await db.insert(schema.service_definitions).values({id:service,seller_id:'benchmark-browser-admin',title:'Operator external service',description:'Disposable audit-only service',price_minor:100,status:'active',capabilities:'["code-review"]'})
      const {privateKeyToAccount}=await import('viem/accounts')
      process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED='true'
      process.env.EVM_SETTLEMENT_PRIVATE_KEY ||= `0x${'99'.repeat(32)}`
      process.env.MPP_SECRET_KEY_CURRENT ||= 'clawdmarket-playwright-mpp-test-secret'
      process.env.MPP_RECIPIENT_ADDRESS ||= privateKeyToAccount(`0x${'99'.repeat(32)}`).address
      process.env.TEMPO_RPC_URL ||= 'https://rpc.example.invalid'
      const {createSpendingAccount,spendingAccountInput}=await import('../../lib/organization-spending-accounts')
      const result=await createSpendingAccount(organization,id!,spendingAccountInput.parse({version:3,client_reference:crypto.randomUUID(),name:'Original Tempo audit grant',buyer_agent_id:agent,team_id:null,cost_center:'OPERATOR_FIXTURE',allowed_services:[{service_id:service,provider_share_id:null}],max_purchase:'1.00',max_daily:'1.00',max_monthly:'1.00',max_lifetime:'1.00',expires_at:new Date(Date.now()+3600000).toISOString(),payment:{rail:'mpp',chain_id:4217,token_address:'0x20c0000000000000000000000000000000000000',payer_address:`0x${'18'.repeat(20)}`,treasury_address:(process.env.MPP_RECIPIENT_ADDRESS||'').toLowerCase(),minimum_token_reserve_units:'1000000',fee_token_address:'0x20c0000000000000000000000000000000000000',minimum_fee_token_reserve_units:'1000000',max_fee_token_cost_units:'10000',max_lifetime_fee_token_cost_units:'10000'}}))
      console.log(JSON.stringify({account:result.account.id,organization}))
    }else if(mode==='enterprise_uncertain'||mode==='enterprise_repair'){
      if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('Original disposable spending account required')
      const [account]=await db.select().from(schema.organization_spending_accounts).where(eq(schema.organization_spending_accounts.id,id!))
      if(account?.name!=='Original Tempo audit grant')throw Error('Fixture grant required')
      await db.update(schema.organization_spending_accounts).set({max_lifetime_minor:mode==='enterprise_uncertain'?99:100}).where(eq(schema.organization_spending_accounts.id,id!))
      console.log(JSON.stringify({fixture:mode}))
    }
    else {
      if (!/^routing-viewer-[a-f0-9-]{36}$/.test(id || '')) throw Error('Original fixture account required')
      if (mode === 'uncertain') await db.insert(schema.credit_accounts).values({ user_id: id, available_minor: 1 }).onConflictDoUpdate({ target: schema.credit_accounts.user_id, set: { available_minor: 1 } })
      else await db.update(schema.credit_accounts).set({ available_minor: 0 }).where(eq(schema.credit_accounts.user_id, id))
      console.log(JSON.stringify({ fixture: mode }))
    }
  } finally { db.$client.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
