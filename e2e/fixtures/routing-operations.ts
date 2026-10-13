/** Guarded disposable browser fixtures. No deployed database or wallet access. */
export {}
async function main() {
  if (!process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-') || process.env.TURSO_AUTH_TOKEN) throw Error('Disposable local database required')
  const [mode, id] = process.argv.slice(2)
  if (!['seed', 'uncertain', 'repair', 'enterprise', 'enterprise_uncertain', 'enterprise_repair', 'enterprise_fees', 'enterprise_fee_uncertain', 'enterprise_fee_repair', 'enterprise_fee_missing'].includes(mode)) throw Error('Unknown fixture mode')
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
    } else if(mode==='enterprise'||mode==='enterprise_fees'){
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
      const result=await createSpendingAccount(organization,id!,spendingAccountInput.parse({version:3,client_reference:crypto.randomUUID(),name:'Original Tempo audit grant',buyer_agent_id:agent,team_id:null,cost_center:'OPERATOR_FIXTURE',allowed_services:[{service_id:service,provider_share_id:null}],max_purchase:mode==='enterprise_fees'?'1.05':'1.00',max_daily:mode==='enterprise_fees'?'1.05':'1.00',max_monthly:mode==='enterprise_fees'?'1.05':'1.00',max_lifetime:mode==='enterprise_fees'?'1.05':'1.00',expires_at:new Date(Date.now()+3600000).toISOString(),payment:{rail:'mpp',chain_id:4217,token_address:'0x20c0000000000000000000000000000000000000',payer_address:`0x${'18'.repeat(20)}`,treasury_address:(process.env.MPP_RECIPIENT_ADDRESS||'').toLowerCase(),minimum_token_reserve_units:'1000000',fee_token_address:'0x20c0000000000000000000000000000000000000',minimum_fee_token_reserve_units:'1000000',max_fee_token_cost_units:'10000',max_lifetime_fee_token_cost_units:'10000'}}))
      if(mode==='enterprise_fees'){
        const buyer=`user_agent_${agent}`
        await (await import('../../lib/external-settlement')).recordPayoutAddress('benchmark-browser-admin',process.env.MPP_RECIPIENT_ADDRESS as `0x${string}`)
        await db.insert(schema.users).values({id:buyer,name:'Stored browser fee fixture',email:`${agent}@test.invalid`,password_hash:'unused'})
        await db.update(schema.service_definitions).set({provider_protocol:'leased_v1',output_schema:'{"type":"object"}',verification_policy:'{"required":true,"methods":["buyer_review","schema"],"acceptance":{"version":1,"mode":"explicit_buyer"}}'}).where(eq(schema.service_definitions.id,service))
        const domain=await import('../../lib/organization-purchasing'),expires=new Date(Date.now()+1800000).toISOString(),order={client_reference:crypto.randomUUID(),objective:'Stored private fee display fixture',input:{},payment_rail:'mpp',max_total:'1.05'}
        const requested=await domain.createPurchaseRequest(organization,id!,domain.purchaseRequestInput.parse({version:1,client_reference:crypto.randomUUID(),buyer_agent_id:agent,service_id:service,requester_role_id:null,reviewer_role_id:null,order,expires_at:expires}))
        const approved=await domain.approvePurchase(organization,requested.request.id,id!,domain.purchaseDecisionInput.parse({version:1,client_reference:crypto.randomUUID(),request_hash:requested.request.request_hash,approve:true,expires_at:expires}))
        const {NextRequest}=await import('next/server'),{resolveSpendingAccount}=await import('../../lib/organization-spending-accounts'),{reserveServiceOrder}=await import('../../lib/service-order-reservation'),{serviceOrderInput}=await import('../../lib/service-definitions')
        const original=await resolveSpendingAccount(new NextRequest(`http://localhost/api/organizations/${organization}/spending-accounts/orders`,{headers:{Authorization:`Bearer ${result.api_key}`}}),organization)
        if(!original)throw Error('Original browser spending grant required')
        const reserved=await reserveServiceOrder({serviceId:service,principal:{userId:buyer,agentId:agent,kind:'registered-agent',usesCookieAuth:false},request:serviceOrderInput.parse({...order,purchasing_approval_id:approved.approval.id}),organizationSpendingEvidence:original})
        // Modeled stored observation for presentation only; economic provenance is tested separately with actual nodes.
        const txHash=`0x${'ab'.repeat(32)}`,payer=result.account.payment!.payer_address,token='0x20c0000000000000000000000000000000000000'
        const evidence={version:1,model:'tempo_pathusd_sender_fee_v1',chain_id:4217,tx_hash:txHash,block_hash:`0x${'bc'.repeat(32)}`,block_number:'5',payer_address:payer,fee_asset:'fee_token',unit:'token_base_units',fee_token_address:token,fee_manager_address:'0xfeec000000000000000000000000000000000000',fee_log_index:'0',gas_price_unit:'attousd',gas_price_scale:'1000000000000',gas_used:'21000',effective_gas_price:'1000000000',execution_fee_units:'21',blob_fee_units:'0',total_fee_units:'21',fee_transfer_amount_units:'21'}
        const [receipt]=await db.insert(schema.payment_receipts).values({route:'browser fee display fixture',trade_id:reserved.trade.id,payment_rail:'mpp',amount:1.05,currency:'USD',tx_hash:txHash,chain_fee_evidence_json:JSON.stringify(evidence),payer_address:payer,token_address:token,chain_id:4217,token_decimals:6,token_amount:'1050000',token_usd_price:1}).returning()
        console.log(JSON.stringify({account:result.account.id,organization,receipt:receipt.id}))
      }else console.log(JSON.stringify({account:result.account.id,organization}))

    }else if(['enterprise_fee_uncertain','enterprise_fee_repair','enterprise_fee_missing'].includes(mode)){
      if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('Original disposable receipt required')
      const [receipt]=await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.id,id!))
      if(receipt?.route!=='browser fee display fixture'||receipt.chain_id!==4217)throw Error('Stored browser fee fixture required')
      const evidence={version:1,model:'tempo_pathusd_sender_fee_v1',chain_id:4217,tx_hash:mode==='enterprise_fee_uncertain'?`0x${'ff'.repeat(32)}`:receipt.tx_hash,block_hash:`0x${'bc'.repeat(32)}`,block_number:'5',payer_address:receipt.payer_address,fee_asset:'fee_token',unit:'token_base_units',fee_token_address:receipt.token_address,fee_manager_address:'0xfeec000000000000000000000000000000000000',fee_log_index:'0',gas_price_unit:'attousd',gas_price_scale:'1000000000000',gas_used:'21000',effective_gas_price:'1000000000',execution_fee_units:'21',blob_fee_units:'0',total_fee_units:'21',fee_transfer_amount_units:'21'}
      await db.update(schema.payment_receipts).set({chain_fee_evidence_json:mode==='enterprise_fee_missing'?null:JSON.stringify(evidence)}).where(eq(schema.payment_receipts.id,id!))
      console.log(JSON.stringify({fixture:mode}))
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
