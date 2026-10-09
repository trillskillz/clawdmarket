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
  const original=await request.get(`/api/organizations/${org}/purchasing/requests/${quote.id}`,{headers});expect((await original.json()).use).toBeNull()
  await context.clearCookies();await page.reload();await expect(page.getByText('Exact service automation',{exact:true})).toHaveCount(0)
})
