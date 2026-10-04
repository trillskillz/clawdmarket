import { test, expect } from '@playwright/test'
import { createClient } from '@libsql/client'
import { randomUUID } from 'node:crypto'

// Funding fixtures must never target a user's workspace or a remote database.
const fixtureUrl = process.env.TURSO_DATABASE_URL || ''
test('prepaid instant call settles once over HTTP and returns unused deposited credit', async ({ request, playwright }) => {
 test.skip(fixtureUrl !== 'file:/tmp/clawdmarket-instant-browser.db', 'Requires the isolated instant browser database')
 const db = createClient({ url: fixtureUrl })
 const users: Array<{ id: string; token: string }> = []
 for (const role of ['buyer','seller']) {
  const email = `instant.${role}.${randomUUID()}@example.com`, password = 'Password123!'
  const register = await request.post('/api/auth/register',{headers:{'x-forwarded-for':`2001:db8:${(Date.now()%65535).toString(16)}:${role==='buyer'?'ac':'bc'}::1`},data:{email,password,name:`Instant ${role}`,role:'human'}})
  expect(register.status()).toBe(201)
  const login = await request.post('/api/auth/login',{data:{email,password}});expect(login.ok()).toBeTruthy()
  const body = await login.json();users.push({id:body.user.id,token:body.token})
 }
 const [buyer,seller] = users, buyerAuth={Authorization:`Bearer ${buyer.token}`}, sellerAuth={Authorization:`Bearer ${seller.token}`}
 const id=randomUUID(), txHash=`0x${randomUUID().replaceAll('-','').repeat(2)}`, now=Math.floor(Date.now()/1000)
 const payer=`0x${'66'.repeat(20)}`,token=`0x${'44'.repeat(20)}`,treasury=process.env.TREASURY_ADDRESS!
 try {
  await db.batch([
   {sql:"INSERT INTO credit_deposits (id,user_id,client_reference,amount_minor,payer,treasury,token,chain_id,tx_hash,payer_signature,state,created_at,expires_at) VALUES (?,?,?,100,?,?,?,8453,?,'local-fixture-proof','confirmed',?,?)",args:[id,buyer.id,id,payer,treasury,token,txHash,now,now+3600]},
   {sql:"INSERT INTO payment_receipts (id,route,payment_rail,amount,currency,tx_hash,payer_address,token_address,chain_id,token_decimals,token_amount,external_id,created_at) VALUES (?,'/api/wallet/deposits','evm',1,'USDC',?,?,?,8453,6,'1000000',?,?)",args:[randomUUID(),txHash,payer,token,id,now]},
   {sql:'INSERT INTO credit_accounts (user_id,available_minor,escrow_minor) VALUES (?,100,0)',args:[buyer.id]},
   {sql:"INSERT INTO credit_entries (id,user_id,reference,kind,available_delta,escrow_delta,created_at) VALUES (?,?,?,'deposit',100,0,?)",args:[randomUUID(),buyer.id,id,now]},
  ],'write')
 } finally { db.close() }
 const shape={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}
 const created=await request.post('/api/instant/services',{headers:sellerAuth,data:{title:'Instant HTTP fixture transform',capabilities:['code-review'],input_schema:shape,output_schema:shape,unit_price_minor:2,deadline_seconds:60}})
 expect(created.status()).toBe(201);const service=(await created.json()).service
 const authority={client_reference:randomUUID(),budget_minor:10,expected_unit_price_minor:2,expires_in_seconds:300,acceptance:'schema_v1',payment_rail:'credit'}
 const opened=await request.post(`/api/instant/services/${service.id}/sessions`,{headers:buyerAuth,data:authority});expect(opened.status()).toBe(201)
 const session=(await opened.json()).session
 const payload={client_reference:randomUUID(),input:{text:'hello'}}
 const [first,second]=await Promise.all([request.post(`/api/instant/sessions/${session.id}/calls`,{headers:buyerAuth,data:payload}),request.post(`/api/instant/sessions/${session.id}/calls`,{headers:buyerAuth,data:payload})])
 expect([first.status(),second.status()].sort()).toEqual([200,202]);const call=(await first.json()).call;expect((await second.json()).call.id).toBe(call.id)
 const anonymous=await playwright.request.newContext({baseURL:'http://localhost:3000'})
 try{expect((await anonymous.get(`/api/instant/calls/${call.id}`)).status()).toBe(401)}finally{await anonymous.dispose()}
 const lease=randomUUID()+randomUUID()
 const claimed=await request.post(`/api/instant/calls/${call.id}/claim`,{headers:sellerAuth,data:{lease_token:lease}});expect(claimed.status()).toBe(200)
 const submission={outcome:'completed',lease_token:lease,output:{text:'HELLO'}}
 const [a,b]=await Promise.all([request.post(`/api/instant/calls/${call.id}/result`,{headers:sellerAuth,data:submission}),request.post(`/api/instant/calls/${call.id}/result`,{headers:sellerAuth,data:submission})])
 expect(a.status()).toBe(200);expect(b.status()).toBe(200);const left=await a.json(),right=await b.json();expect(left.call.receipt).toEqual(right.call.receipt);expect(left.call.receipt.amount_minor).toBe(2)
 const observed=await request.get(`/api/instant/calls/${call.id}`,{headers:buyerAuth});expect(observed.headers()['cache-control']).toContain('private, no-store');expect((await observed.json()).call.output).toEqual({text:'HELLO'})
 const closed=await request.post(`/api/instant/sessions/${session.id}`,{headers:buyerAuth,data:{action:'close'}});expect(closed.status()).toBe(200);expect((await closed.json()).session.refunded_minor).toBe(8)
 const wallet=await request.get('/api/wallet',{headers:buyerAuth});expect(wallet.ok()).toBeTruthy();const balance=await wallet.json();expect(balance.credit.available_minor).toBe(98);expect(balance.instant_credit.prepaid_minor).toBe(0)
 const sellerWallet=await request.get('/api/wallet',{headers:sellerAuth});expect((await sellerWallet.json()).credit.available_minor).toBe(2)
})
