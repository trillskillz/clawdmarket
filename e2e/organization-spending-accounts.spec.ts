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

test('owner explicitly reviews L1/Tempo grant terms and recovers a committed lost reply across reload without another credential',async({request,page,context})=>{
  test.setTimeout(60000)
  const registered=await request.post('/api/agents/register',{headers:{'x-forwarded-for':`2001:db8:${(Date.now()%65535).toString(16)}::b61`},data:{name:`Reviewed buyer ${crypto.randomUUID().slice(0,8)}`,activation_mode:'autonomous',capabilities:['code-review']}})
  expect(registered.status()).toBe(201);const agent=(await registered.json()).agent
  const fixture=(mode:string)=>promisify(execFile)(process.execPath,['--conditions=react-server','--import','tsx','e2e/fixtures/workflow-approval.ts',mode,agent.id],{env:{...process.env,JWT_SECRET:process.env.JWT_SECRET||'clawdmarket-playwright-jwt-secret'},timeout:20000})
  const owner=JSON.parse((await fixture('owners')).stdout),service=JSON.parse((await fixture('service')).stdout),headers={Authorization:`Bearer ${owner.owner_key}`}
  const created=await request.post('/api/organizations',{headers,data:{client_reference:crypto.randomUUID(),name:'Reviewed wallet grants'}});expect(created.status()).toBe(201)
  const org=(await created.json()).organization.id,path=`/api/organizations/${org}/spending-accounts`,url=`/organizations/${org}/spending-accounts`,storageKey=`clawdmarket.owner-spending-review:${org}`
  expect((await request.put(`/api/organizations/${org}/agents`,{headers,data:{agent_id:agent.id,cost_center:'REVIEWED_WORK'}})).status()).toBe(200)
  await context.addCookies([{name:'auth-token',value:owner.owner_key,url:'http://localhost:3000'},{name:'csrf-token',value:'wallet-review-csrf',url:'http://localhost:3000'}])
  const payer=`0x${'18'.repeat(20)}`
  let submissions=0,lostKey='',lostAccount=''
  page.on('request',req=>{if(req.method()==='POST'&&req.url().endsWith(path))submissions++})
  for(const rail of ['evm','mpp']){
    await page.goto(url);await expect(page.getByLabel('Assigned buyer')).toBeEnabled()
    await page.getByLabel('Assigned buyer').selectOption(agent.id);await page.getByLabel('Approved service').selectOption(`${service.service}:`)
    await page.getByLabel('Account name').fill(rail==='evm'?'Owner reviewed L1':'Original reviewed Tempo')
    await page.getByLabel('Payment authority').selectOption(rail)
    if(rail==='evm')await page.getByLabel('Reviewed L1 asset').selectOption(`1:0x${'45'.repeat(20)}`)
    await page.getByLabel('Buyer payer address').fill(payer)
    const prior=submissions
    await page.getByRole('button',{name:'Review wallet grant',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Review original spending grant'})).toBeVisible();expect(submissions).toBe(prior)
    await expect(page.getByRole('button',{name:'Confirm reviewed grant',exact:true})).toBeDisabled()
    const saved=JSON.parse((await page.evaluate(key=>sessionStorage.getItem(key),storageKey))!)
    expect(saved.grant.version).toBe(rail==='evm'?2:3);expect(saved.grant.expected_token_decimals).toBe(6);expect(saved.grant.expected_token_usd_price).toBe(1);expect(saved.grant.payment.payer_address).toBe(payer)
    expect(saved.grant.payment.minimum_token_reserve_units).toBe('1000000');expect(saved.phase).toBe('reviewed');expect(JSON.stringify(saved)).not.toContain('api_key')
    await expect(page.getByText(`Buyer payer ${payer}`,{exact:true})).toBeVisible()
    await page.reload();await expect(page.getByRole('heading',{name:'Review original spending grant'})).toBeVisible()
    await expect(page.getByRole('button',{name:'Confirm reviewed grant',exact:true})).toBeDisabled()
    expect(JSON.parse((await page.evaluate(key=>sessionStorage.getItem(key),storageKey))!).grant).toEqual(saved.grant)
    await page.getByRole('checkbox').check()
    if(rail==='mpp')await page.route(`**${path}`,async route=>{
      if(route.request().method()!=='POST'){await route.continue();return}
      const response=await route.fetch();expect(response.status()).toBe(201);const value=await response.json();lostKey=value.api_key;lostAccount=value.account.id;await route.abort('failed')
    })
    await page.getByRole('button',{name:'Confirm reviewed grant',exact:true}).click()
    if(rail==='evm'){
      await expect(page.getByTestId('spending-key')).toBeVisible();const key=await page.getByTestId('spending-key').innerText();expect(key).toMatch(/^cmos_/)
      expect(await page.evaluate(key=>sessionStorage.getItem(key),storageKey)).toBeNull()
      const recorded=await request.get(`${path}?client_reference=${saved.grant.client_reference}`,{headers});const account=(await recorded.json()).spending_accounts[0].account
      expect(account.version).toBe(2);expect(account.payment.minimum_native_reserve_wei).toBe('1000000000000000');expect(account.payment.max_gas_cost_wei).toBe('1000000000000000');expect(await recorded.text()).not.toContain(key)
      await page.reload();await expect(page.getByTestId('spending-key')).toHaveCount(0)
    }else{
      await expect(page.getByRole('status')).toContainText('response was lost')
      expect(JSON.parse((await page.evaluate(key=>sessionStorage.getItem(key),storageKey))!).phase).toBe('request_started')
      await page.unroute(`**${path}`);await page.reload();await expect(page.getByRole('heading',{name:'Review original spending grant'})).toBeVisible()
      await expect(page.getByRole('button',{name:'Retry original reviewed grant',exact:true})).toBeDisabled()
      await page.getByRole('button',{name:'Inspect original grant',exact:true}).click()
      await expect(page.getByRole('status')).toContainText('original grant is recorded');await expect(page.getByRole('heading',{name:'Review original spending grant'})).toHaveCount(0)
      expect(submissions).toBe(prior+1);expect(await page.evaluate(key=>sessionStorage.getItem(key),storageKey)).toBeNull();expect(await page.content()).not.toContain(lostKey)
      const inventory=(await (await request.get(path,{headers})).json()).spending_accounts
      expect(inventory).toHaveLength(2);expect(inventory.find((entry:{account:{id:string}})=>entry.account.id===lostAccount).account.payment.max_fee_token_cost_units).toBe('10000')
      const replay=await request.post(path,{headers,data:saved.grant});expect(replay.status()).toBe(200);expect((await replay.json()).api_key).toBeNull()
      const card=page.getByRole('heading',{name:'Original reviewed Tempo',exact:true}).locator('..')
      await card.getByRole('button',{name:'Revoke spending credential'}).click();await expect(page.getByRole('status')).toContainText('revoked')
    }
  }
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await context.clearCookies();await page.reload();await expect(page.getByRole('heading',{name:'Owner reviewed L1',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Original reviewed Tempo',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Review original spending grant'})).toHaveCount(0)
})

test('owner retains the original creation reference after a pre-commit lost reply and explicitly resumes the saved grant',async({request,page,context})=>{
  const registered=await request.post('/api/agents/register',{headers:{'x-forwarded-for':`2001:db8:${(Date.now()%65535).toString(16)}::b62`},data:{name:`Resume buyer ${crypto.randomUUID().slice(0,8)}`,activation_mode:'autonomous',capabilities:['code-review']}})
  expect(registered.status()).toBe(201);const agent=(await registered.json()).agent
  const fixture=(mode:string)=>promisify(execFile)(process.execPath,['--conditions=react-server','--import','tsx','e2e/fixtures/workflow-approval.ts',mode,agent.id],{env:{...process.env,JWT_SECRET:process.env.JWT_SECRET||'clawdmarket-playwright-jwt-secret'},timeout:20000})
  const owner=JSON.parse((await fixture('owners')).stdout),service=JSON.parse((await fixture('service')).stdout),headers={Authorization:`Bearer ${owner.owner_key}`}
  const created=await request.post('/api/organizations',{headers,data:{client_reference:crypto.randomUUID(),name:'Resume exact review'}});expect(created.status()).toBe(201)
  const org=(await created.json()).organization.id,path=`/api/organizations/${org}/spending-accounts`,storageKey=`clawdmarket.owner-spending-review:${org}`
  expect((await request.put(`/api/organizations/${org}/agents`,{headers,data:{agent_id:agent.id,cost_center:'RESUME_WORK'}})).status()).toBe(200)
  await context.addCookies([{name:'auth-token',value:owner.owner_key,url:'http://localhost:3000'},{name:'csrf-token',value:'wallet-resume-csrf',url:'http://localhost:3000'}])
  await page.goto(`/organizations/${org}/spending-accounts`);await expect(page.getByLabel('Assigned buyer')).toBeEnabled()
  await page.getByLabel('Assigned buyer').selectOption(agent.id);await page.getByLabel('Approved service').selectOption(`${service.service}:`)
  await page.getByLabel('Payment authority').selectOption('evm');await page.getByLabel('Reviewed L1 asset').selectOption(`1:0x${'45'.repeat(20)}`);await page.getByLabel('Buyer payer address').fill(`0x${'18'.repeat(20)}`)
  await page.getByLabel('Token reserve',{exact:false}).fill('0.0000001');await page.getByRole('button',{name:'Review wallet grant',exact:true}).click();await expect(page.getByRole('status')).toContainText('Unable to save the exact grant');expect(await page.evaluate(key=>sessionStorage.getItem(key),storageKey)).toBeNull()
  await page.getByLabel('Token reserve',{exact:false}).fill('1');await page.getByRole('button',{name:'Review wallet grant',exact:true}).click();await expect(page.getByRole('heading',{name:'Review original spending grant'})).toBeVisible()
  const original=JSON.parse((await page.evaluate(key=>sessionStorage.getItem(key),storageKey))!).grant
  await page.route(`**${path}`,async route=>route.request().method()==='POST'?route.abort('failed'):route.continue())
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirm reviewed grant',exact:true}).click();await expect(page.getByRole('status')).toContainText('response was lost')
  expect((await (await request.get(path,{headers})).json()).spending_accounts).toHaveLength(0)
  await page.unroute(`**${path}`);await page.reload();await expect(page.getByRole('button',{name:'Retry original reviewed grant',exact:true})).toBeDisabled()
  expect(JSON.parse((await page.evaluate(key=>sessionStorage.getItem(key),storageKey))!).grant).toEqual(original)
  await page.getByRole('button',{name:'Inspect original grant',exact:true}).click();await expect(page.getByRole('status')).toContainText('not found')
  // A definite failure of this retry cannot resolve the earlier unknown request.
  await page.route(`**${path}`,async route=>{
    if(route.request().method()!=='POST'){await route.continue();return}
    const response=await route.fetch({postData:JSON.stringify({...route.request().postDataJSON(),expected_token_decimals:18})});expect(response.status()).toBe(409);await route.fulfill({response})
  })
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Retry original reviewed grant',exact:true}).click();await expect(page.getByRole('status')).toContainText('SPENDING_PAYMENT_METADATA_CHANGED')
  expect(JSON.parse((await page.evaluate(key=>sessionStorage.getItem(key),storageKey))!).phase).toBe('request_started');await expect(page.getByRole('button',{name:'Edit before granting',exact:true})).toHaveCount(0)
  expect(JSON.parse((await page.evaluate(key=>sessionStorage.getItem(key),storageKey))!).grant).toEqual(original)
  await page.unroute(`**${path}`);await page.getByRole('button',{name:'Retry original reviewed grant',exact:true}).click();await expect(page.getByTestId('spending-key')).toBeVisible()
  const inventory=(await (await request.get(path,{headers})).json()).spending_accounts;expect(inventory).toHaveLength(1);expect(inventory[0].account.client_reference).toBe(original.client_reference)
  expect(await page.evaluate(key=>sessionStorage.getItem(key),storageKey)).toBeNull();await page.reload();await expect(page.getByTestId('spending-key')).toHaveCount(0)
})

test('owner can refresh and review configured metadata after a definite pre-insertion mismatch without losing an uncertain original grant',async({request,page,context})=>{
  const registered=await request.post('/api/agents/register',{headers:{'x-forwarded-for':`2001:db8:${(Date.now()%65535).toString(16)}::b63`},data:{name:`Metadata buyer ${crypto.randomUUID().slice(0,8)}`,activation_mode:'autonomous',capabilities:['code-review']}})
  expect(registered.status()).toBe(201);const agent=(await registered.json()).agent
  const fixture=(mode:string)=>promisify(execFile)(process.execPath,['--conditions=react-server','--import','tsx','e2e/fixtures/workflow-approval.ts',mode,agent.id],{env:{...process.env,JWT_SECRET:process.env.JWT_SECRET||'clawdmarket-playwright-jwt-secret'},timeout:20000})
  const owner=JSON.parse((await fixture('owners')).stdout),service=JSON.parse((await fixture('service')).stdout),headers={Authorization:`Bearer ${owner.owner_key}`}
  const created=await request.post('/api/organizations',{headers,data:{client_reference:crypto.randomUUID(),name:'Exact metadata review'}});expect(created.status()).toBe(201)
  const org=(await created.json()).organization.id,path=`/api/organizations/${org}/spending-accounts`,storageKey=`clawdmarket.owner-spending-review:${org}`
  expect((await request.put(`/api/organizations/${org}/agents`,{headers,data:{agent_id:agent.id,cost_center:'METADATA_WORK'}})).status()).toBe(200)
  await context.addCookies([{name:'auth-token',value:owner.owner_key,url:'http://localhost:3000'},{name:'csrf-token',value:'metadata-review-csrf',url:'http://localhost:3000'}])
  await page.route('**/api/payments/config',async route=>{
    const response=await route.fetch(),value=await response.json();value.accepted_tokens=value.accepted_tokens.map((token:{chain_id:number;decimals:number})=>({...token,decimals:token.chain_id===1?18:token.decimals}));await route.fulfill({response,json:value})
  })
  const fields=async()=>{
    await page.getByLabel('Assigned buyer').selectOption(agent.id);await page.getByLabel('Approved service').selectOption(`${service.service}:`);await page.getByLabel('Payment authority').selectOption('evm');await page.getByLabel('Reviewed L1 asset').selectOption(`1:0x${'45'.repeat(20)}`);await page.getByLabel('Buyer payer address').fill(`0x${'18'.repeat(20)}`)
  }
  await page.goto(`/organizations/${org}/spending-accounts`);await fields();await page.getByRole('button',{name:'Review wallet grant',exact:true}).click()
  const stale=JSON.parse((await page.evaluate(key=>sessionStorage.getItem(key),storageKey))!).grant;expect(stale.expected_token_decimals).toBe(18)
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirm reviewed grant',exact:true}).click();await expect(page.getByRole('status')).toContainText('SPENDING_PAYMENT_METADATA_CHANGED')
  expect((await (await request.get(path,{headers})).json()).spending_accounts).toHaveLength(0);await expect(page.getByTestId('spending-key')).toHaveCount(0)
  expect(JSON.parse((await page.evaluate(key=>sessionStorage.getItem(key),storageKey))!).phase).toBe('reviewed');await expect(page.getByRole('checkbox')).not.toBeChecked()
  await page.unroute('**/api/payments/config');await page.reload();await expect(page.getByRole('heading',{name:'Review original spending grant'})).toBeVisible()
  await page.getByRole('button',{name:'Edit before granting',exact:true}).click();await fields();await page.getByRole('button',{name:'Review wallet grant',exact:true}).click()
  const refreshed=JSON.parse((await page.evaluate(key=>sessionStorage.getItem(key),storageKey))!).grant;expect(refreshed.expected_token_decimals).toBe(6);expect(refreshed.client_reference).not.toBe(stale.client_reference)
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirm reviewed grant',exact:true}).click();await expect(page.getByTestId('spending-key')).toBeVisible()
  expect((await (await request.get(path,{headers})).json()).spending_accounts).toHaveLength(1)
})
