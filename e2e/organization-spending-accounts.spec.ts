import { test,expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
test('owner grants and revokes a bounded once-only service credit key without promoting read keys or unbacked credit',async({request,page,context})=>{
  const registered=await request.post('/api/agents/register',{headers:{'x-forwarded-for':`2001:db8:${(Date.now()%65535).toString(16)}::b60`},data:{name:`Spending buyer ${crypto.randomUUID().slice(0,8)}`,activation_mode:'autonomous',capabilities:['code-review']}})
  expect(registered.status()).toBe(201);const agent=(await registered.json()).agent
  const fixture=(mode:string)=>promisify(execFile)(process.execPath,['--conditions=react-server','--import','tsx','e2e/fixtures/workflow-approval.ts',mode,agent.id],{env:{...process.env,JWT_SECRET:process.env.JWT_SECRET||'clawdmarket-playwright-jwt-secret'},timeout:20000})
  const owner=JSON.parse((await fixture('owners')).stdout),service=JSON.parse((await fixture('service')).stdout),headers={Authorization:`Bearer ${owner.owner_key}`}
  const created=await request.post('/api/organizations',{headers,data:{client_reference:crypto.randomUUID(),name:'Bounded spending controls'}})
  expect(created.status()).toBe(201);const org=(await created.json()).organization.id,path=`/api/organizations/${org}/spending-accounts`
  expect((await request.put(`/api/organizations/${org}/agents`,{headers,data:{agent_id:agent.id,cost_center:'APPROVED_WORK'}})).status()).toBe(200)
  await context.addCookies([{name:'auth-token',value:owner.owner_key,url:'http://localhost:3000'},{name:'csrf-token',value:'spending-browser-csrf',url:'http://localhost:3000'}])
  await page.goto(`/organizations/${org}/spending-accounts`)
  await expect(page.getByRole('heading',{name:'Spending accounts',exact:true})).toBeVisible()
  await page.getByLabel('Assigned buyer').selectOption(agent.id)
  await page.getByLabel('Approved service').selectOption(`${service.service}:`)
  await page.getByLabel('Account name').fill('Exact service automation')
  await page.getByRole('button',{name:'Grant spending account'}).click()
  await expect(page.getByRole('status')).toHaveText('Spending account created. Copy the key now; it is shown once.')
  const key=await page.getByTestId('spending-key').innerText();expect(key).toMatch(/^cmos_[a-f0-9]{64}$/)
  const inventory=await request.get(path,{headers});expect(inventory.headers()['cache-control']).toContain('private, no-store');const account=(await inventory.json()).spending_accounts[0].account
  expect(account.cost_center).toBe('APPROVED_WORK');expect(account.max_lifetime).toBe('1.00');expect(await inventory.text()).not.toContain(key)
  const order={client_reference:crypto.randomUUID(),objective:'Only buy the approved service with deposited credit',input:{},payment_rail:'credit',max_total:'1.00',expected_price:'0.95'}
  const purchase=await request.post(`/api/organizations/${org}/purchasing/requests`,{headers,data:{version:1,client_reference:crypto.randomUUID(),buyer_agent_id:agent.id,service_id:service.service,requester_role_id:null,reviewer_role_id:null,order,expires_at:new Date(Date.now()+1800_000).toISOString()}})
  expect(purchase.status(),await purchase.text()).toBe(201);const quote=(await purchase.json()).request
  const approved=await request.post(`/api/organizations/${org}/purchasing/requests/${quote.id}/approval`,{headers,data:{version:1,client_reference:crypto.randomUUID(),request_hash:quote.request_hash,approve:true,expires_at:quote.expires_at}})
  expect(approved.status()).toBe(201);const exact={...order,purchasing_approval_id:(await approved.json()).approval.id},spendHeaders={Authorization:`Bearer ${key}`}
  const denied=await request.post(path+'/orders',{headers:spendHeaders,data:{service_id:service.service,order:exact}});expect(denied.status(),await denied.text()).toBe(402);expect((await denied.json()).error_code).toBe('INSUFFICIENT_CREDIT')
  expect((await request.post(`/api/services/${service.service}/orders`,{headers:spendHeaders,data:exact})).status()).toBe(401)
  expect((await request.get(path,{headers:{Authorization:`Bearer ${owner.outsider_key}`}})).status()).toBe(404)
  await page.reload();await expect(page.getByTestId('spending-key')).toHaveCount(0)
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  await page.getByRole('button',{name:'Revoke spending credential'}).click()
  await expect(page.getByRole('status')).toHaveText('Spending credential revoked. Original purchases remain available to their buyer and provider.')
  expect((await request.post(path+'/orders',{headers:spendHeaders,data:{service_id:service.service,order:exact}})).status()).toBe(401)
  const {privateKeyToAccount}=await import('viem/accounts'),treasury=privateKeyToAccount(`0x${'99'.repeat(32)}`).address
  const external=await request.post(path,{headers,data:{version:2,client_reference:crypto.randomUUID(),name:'Reviewed wallet account',buyer_agent_id:agent.id,team_id:null,cost_center:'APPROVED_WORK',allowed_services:[{service_id:service.service,provider_share_id:null}],max_purchase:'1.00',max_daily:'1.00',max_monthly:'1.00',max_lifetime:'1.00',expires_at:new Date(Date.now()+3600_000).toISOString(),payment:{rail:'evm',chain_id:1,token_address:`0x${'45'.repeat(20)}`,payer_address:treasury,treasury_address:treasury,minimum_token_reserve_units:'1000000',minimum_native_reserve_wei:'1000000',max_gas_cost_wei:'1000000000000000',max_lifetime_gas_cost_wei:'1000000000000000'}}})
  expect(external.status(),await external.text()).toBe(201)
  const externalKey=(await external.json()).api_key
  await page.reload();await expect(page.getByText('Reviewed wallet account',{exact:true})).toBeVisible()
  await expect(page.getByText('Authority: Reviewed external wallet service purchasing')).toBeVisible()
  await page.getByText('Reviewed wallet and fee terms',{exact:true}).click()
  await expect(page.getByText('Rail evm · Chain 1',{exact:true})).toBeVisible()
  await expect(page.getByText('Gas ceiling 1000000000000000 wei per purchase · 1000000000000000 wei lifetime',{exact:true})).toBeVisible()
  expect(await page.content()).not.toContain(externalKey)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  const tempo=await request.post(path,{headers,data:{version:3,client_reference:crypto.randomUUID(),name:'Reviewed Tempo account',buyer_agent_id:agent.id,team_id:null,cost_center:'APPROVED_WORK',allowed_services:[{service_id:service.service,provider_share_id:null}],max_purchase:'1.00',max_daily:'1.00',max_monthly:'1.00',max_lifetime:'1.00',expires_at:new Date(Date.now()+3600_000).toISOString(),payment:{rail:'mpp',chain_id:4217,token_address:'0x20c0000000000000000000000000000000000000',payer_address:treasury,treasury_address:treasury,minimum_token_reserve_units:'1000000',fee_token_address:'0x20c0000000000000000000000000000000000000',minimum_fee_token_reserve_units:'1000000',max_fee_token_cost_units:'10000',max_lifetime_fee_token_cost_units:'10000'}}})
  expect(tempo.status(),await tempo.text()).toBe(201);const tempoKey=(await tempo.json()).api_key
  await page.reload();await expect(page.getByText('Authority: Reviewed Tempo wallet service purchasing')).toBeVisible()
  const tempoCard=page.getByText('Reviewed Tempo account',{exact:true}).locator('..')
  await tempoCard.getByText('Reviewed wallet and fee terms',{exact:true}).click()
  await expect(tempoCard.getByText('Rail mpp · Chain 4217',{exact:true})).toBeVisible()
  await expect(tempoCard.getByText('Fee ceiling 10000 base units per purchase · 10000 base units lifetime',{exact:true})).toBeVisible()
  expect(await page.content()).not.toContain(tempoKey);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  const original=await request.get(`/api/organizations/${org}/purchasing/requests/${quote.id}`,{headers});expect((await original.json()).use).toBeNull()
  await context.clearCookies();await page.reload();await expect(page.getByText('Exact service automation',{exact:true})).toHaveCount(0);await expect(page.getByText('Reviewed wallet account',{exact:true})).toHaveCount(0);await expect(page.getByText('Reviewed Tempo account',{exact:true})).toHaveCount(0)
})
