import { test,expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
test('owners review an exact private offer and the assigned buyer purchases without a public proof or listing',async({request,page,context})=>{
  const registered=await request.post('/api/agents/register',{headers:{'x-forwarded-for':`2001:db8:${(Date.now()%65535).toString(16)}::b59`},data:{name:`Private catalog buyer ${crypto.randomUUID().slice(0,8)}`,activation_mode:'autonomous',capabilities:['code-review']}})
  expect(registered.status()).toBe(201);const agent=(await registered.json()).agent
  const fixture=(mode:string,id=agent.id)=>promisify(execFile)(process.execPath,['--conditions=react-server','--import','tsx','e2e/fixtures/workflow-approval.ts',mode,id],{env:{...process.env,JWT_SECRET:process.env.JWT_SECRET||'clawdmarket-playwright-jwt-secret',AGENT_API_KEY_PEPPER:process.env.AGENT_API_KEY_PEPPER||'clawdmarket-playwright-agent-pepper'},timeout:20000})
  const owner=JSON.parse((await fixture('owners')).stdout),provider=JSON.parse((await fixture('private-service')).stdout)
  const ownerHeaders={Authorization:`Bearer ${owner.owner_key}`},providerHeaders={Authorization:`Bearer ${provider.providerKey}`},providerOwnerHeaders={Authorization:`Bearer ${provider.providerOwnerKey}`},buyerHeaders={Authorization:`Bearer ${agent.api_key}`}
  const created=await request.post('/api/services',{headers:providerHeaders,data:{title:'Confidential browser code review',description:'Review confidential organization source.',capabilities:['code-review'],pricing:{model:'fixed',amount:'0.95',currency:'USD'},visibility:'organization',status:'active',verification_policy:{required:true,methods:['buyer_review'],acceptance:{version:1,mode:'explicit_buyer'}}}})
  expect(created.status(),await created.text()).toBe(201);const service=(await created.json()).service.id
  const organization=await request.post('/api/organizations',{headers:ownerHeaders,data:{client_reference:crypto.randomUUID(),name:'Private provider buyer organization'}})
  expect(organization.status()).toBe(201);const org=(await organization.json()).organization.id
  expect((await request.put(`/api/organizations/${org}/agents`,{headers:ownerHeaders,data:{agent_id:agent.id,cost_center:'PRIVATE_WORK'}})).status()).toBe(200)
  const offer=await request.post(`/api/services/${service}/organization-access`,{headers:providerOwnerHeaders,data:{version:1,client_reference:crypto.randomUUID(),organization_id:org,team_id:null,expires_at:new Date(Date.now()+3600_000).toISOString()}})
  expect(offer.status(),await offer.text()).toBe(201);const share=(await offer.json()).share
  expect((await request.get(`/api/organizations/${org}/providers`,{headers:buyerHeaders})).status()).toBe(200)
  await context.addCookies([{name:'auth-token',value:owner.owner_key,url:'http://localhost:3000'},{name:'csrf-token',value:'private-provider-browser-csrf',url:'http://localhost:3000'}])
  await page.goto(`/organizations/${org}/providers`)
  await expect(page.getByRole('heading',{name:'Private providers',exact:true})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Confidential browser code review'})).toBeVisible()
  await page.getByRole('button',{name:'Accept exact provider offer'}).click()
  await expect(page.getByRole('status')).toHaveText('Private provider accepted.')
  const catalog=await request.get(`/api/organizations/${org}/providers`,{headers:buyerHeaders});expect((await catalog.json()).providers[0].share.id).toBe(share.id)
  const order={client_reference:crypto.randomUUID(),objective:'Review confidential organization source',input:{private_code:'SECRET_BROWSER_INPUT'},payment_rail:'evm',max_total:'1.00',expected_price:'0.95',provider_share_id:share.id}
  const purchase=await request.post(`/api/services/${service}/orders`,{headers:buyerHeaders,data:order});expect(purchase.status(),await purchase.text()).toBe(201);const original=await purchase.json()
  const privateOrder=await request.get(`/api/service-orders/${original.order.id}`,{headers:buyerHeaders});expect(privateOrder.status()).toBe(200)
  expect((await request.get(`/api/service-orders/${original.order.id}`,{headers:{Authorization:`Bearer ${owner.outsider_key}`}})).status()).toBe(404)
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  await page.getByRole('button',{name:'Revoke provider access'}).click();await expect(page.getByRole('status')).toHaveText('Private provider access revoked.')
  const replay=await request.post(`/api/services/${service}/orders`,{headers:buyerHeaders,data:order});expect(replay.status()).toBe(200);expect((await replay.json()).order.id).toBe(original.order.id)
  await fixture('publish-provider',provider.providerAgent)
  const profile=await request.get(`/api/agents/${provider.providerAgent}`);expect(profile.status()).toBe(200);expect(await profile.text()).not.toContain(original.trade.id)
  const services=await request.get('/api/services');expect(await services.text()).not.toContain(service)
  expect((await request.get(`/api/services/${service}`)).status()).toBe(404)
  expect((await request.get(`/api/listings/${original.order.listing_id}`)).status()).toBe(404)
  await context.clearCookies()
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    await page.setViewportSize(viewport);const proof=await page.goto(`/proof/${original.trade.id}`);expect(proof?.status()).toBe(404)
    expect(await page.title()).not.toContain('Confidential browser code review');expect(await page.locator('body').innerText()).not.toContain('SECRET_BROWSER_INPUT')
    await page.goto('/activity');expect(await page.locator('body').innerText()).not.toContain('Confidential browser code review')
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  }
})
