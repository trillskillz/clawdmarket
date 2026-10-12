import { test, expect } from '@playwright/test'

const org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const api=`/api/organizations/${org}/route-authorizations/${id}`,url=`/organizations/${org}/route-authorizations/${id}`
function authorization(role:'owner'|'reviewer') {
  return {id,organization_id:org,authority_hash:'a'.repeat(64),state:'pending',viewer_role:role,buyer_id:'private-buyer',team_id:null,cost_center:'REVIEW',
    route:{objective:'Review original private source with the approved provider',input:{private_text:'PRIVATE_REVIEW_SOURCE'},required_capabilities:['code-review'],candidates:[{service_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',pricing:{estimated_total:'1.05'},explanation:['Current production reputation ordering; history unproven.'],eligibility:{approval_required:true}}]},
    terms:{max_daily_minor:105,max_monthly_minor:105,max_lifetime_minor:105,max_lifetime_gas_cost_wei:'10000000000000000'},
    mandate:{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',terms_hash:'b'.repeat(64),expires_at:new Date(Date.now()+600000).toISOString(),terms:{max_aggregate:'1.05',max_per_execution:'1.05',max_attempts:1,max_retry_budget:'0.00',payment:{chain_id:1,token_address:`0x${'44'.repeat(20)}`,payer_address:`0x${'11'.repeat(20)}`,treasury_address:`0x${'99'.repeat(20)}`,minimum_token_reserve_units:'5000000',minimum_native_reserve_wei:'1000000',max_gas_cost_wei:'10000000000000000'}}},use:null}
}

test('private reviewer sees frozen scope, must explicitly confirm and clears denied inspection on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:1000})
  const a=authorization('reviewer');let denied=false
  await page.route(`**${api}**`,async route=>{
    if(denied)return route.fulfill({status:401,json:{error_code:'ACCOUNT_REQUIRED'}})
    if(route.request().method()==='POST'){expect(route.request().postDataJSON().authority_hash).toBe(a.authority_hash);a.state='approved'}
    await route.fulfill({json:{authorization:a}})
  })
  await page.goto(url)
  await expect(page.getByRole('heading',{name:'Frozen payment terms'})).toBeVisible()
  const approve=page.getByRole('button',{name:'Approve original route'})
  await expect(approve).toBeDisabled()
  await page.getByRole('checkbox').check();await approve.click()
  await expect(page.getByText('Status: approved')).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  const saved=await page.evaluate(()=>Object.values(sessionStorage));expect(saved.join('')).not.toContain('PRIVATE_REVIEW_SOURCE')
  denied=true;await page.getByRole('button',{name:'Refresh original review'}).click()
  await expect(page.getByRole('alert').filter({hasText:'Sign in'})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Frozen payment terms'})).toHaveCount(0)
})

test('owner inspects original scope and revokes fresh spending while approval stays with the selected reviewer',async({page})=>{
  const a=authorization('owner')
  await page.route(`**${api}**`,async route=>{if(route.request().method()==='DELETE')a.state='revoked';await route.fulfill({json:{authorization:a}})})
  await page.goto(url)
  await expect(page.getByText('The selected independent reviewer must approve this proposal.')).toBeVisible()
  await expect(page.getByRole('button',{name:'Approve original route'})).toHaveCount(0)
  await page.getByRole('button',{name:'Revoke fresh spending'}).click()
  await expect(page.getByText('Status: revoked')).toBeVisible()
  await expect(page.getByRole('button',{name:'Revoke fresh spending'})).toHaveCount(0)
})

test('lost approval reply and reload retain the original decision reference; a committed approval never prompts a replacement',async({page})=>{
  const a=authorization('reviewer'),commands:unknown[]=[];let lose=true
  await page.route(`**${api}**`,async route=>{
    if(route.request().method()==='POST'){
      commands.push(route.request().postDataJSON())
      if(lose){lose=false;return route.abort('failed')}
      a.state='approved'
    }
    await route.fulfill({json:{authorization:a}})
  })
  await page.goto(url);await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Approve original route'}).click()
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible()
  await page.reload();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Approve original route'}).click()
  await expect(page.getByText('Status: approved')).toBeVisible();expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0])
  await page.reload();await expect(page.getByText('Status: approved')).toBeVisible();await expect(page.getByRole('button',{name:'Approve original route'})).toHaveCount(0)
})

for(const width of [1440,390])test(`Tempo reviewer inspects fee-token units and preserves its original v2 decision after a lost reply at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000})
  const base=authorization('reviewer'),{max_lifetime_gas_cost_wei:_,...limits}=base.terms
  const a={...base,version:2,terms:{...limits,version:2,max_lifetime_fee_token_cost_units:'10000'},
    mandate:{...base.mandate,terms:{...base.mandate.terms,payment:{rail:'mpp',chain_id:4217,token_address:'0x20c0000000000000000000000000000000000000',payer_address:`0x${'11'.repeat(20)}`,treasury_address:`0x${'99'.repeat(20)}`,minimum_token_reserve_units:'5000000',fee_token_address:'0x20c0000000000000000000000000000000000000',minimum_fee_token_reserve_units:'1000000',max_fee_token_cost_units:'10000'}}}}
  const commands:unknown[]=[];let lose=true
  await page.route(`**${api}**`,async route=>{
    if(route.request().method()==='POST'){
      const body=route.request().postDataJSON();expect(body.version).toBe(2);expect(body.authority_hash).toBe(a.authority_hash);commands.push(body)
      if(lose){lose=false;return route.abort('failed')}
      a.state='approved'
    }
    await route.fulfill({json:{authorization:a}})
  })
  await page.goto(url)
  await expect(page.getByText('Per-payment fee ceiling (pathUSD base units)',{exact:true})).toBeVisible()
  await expect(page.getByText('Lifetime fee ceiling (pathUSD base units)',{exact:true})).toBeVisible()
  await expect(page.getByText('Native reserve (wei)',{exact:true})).toHaveCount(0)
  const approve=page.getByRole('button',{name:'Approve original route'});await expect(approve).toBeDisabled()
  await page.getByRole('checkbox').check();await approve.click();await expect(page.getByRole('main').getByRole('alert')).toBeVisible()
  await page.reload();await page.getByRole('checkbox').check();await approve.click();await expect(page.getByText('Status: approved')).toBeVisible()
  expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  expect((await page.evaluate(()=>Object.values(sessionStorage))).join('')).not.toContain('PRIVATE_REVIEW_SOURCE')
})

for(const version of [3,4])for(const width of [1440,390])test(`private-provider v${version} reviewer sees original two-owner consent and recovers its exact decision at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000})
  const base=authorization('reviewer'),share={id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',service_id:base.route.candidates[0].service_id,organization_owner_id:'PRIVATE_ORGANIZATION_OWNER',provider_owner_id:'PRIVATE_PROVIDER_OWNER',team_id:null,expires_at:new Date(Date.now()+3600000).toISOString(),consent_hash:'c'.repeat(64)}
  const a={...base,version,terms:{...base.terms,provider_shares:[share],...(version===4?{max_lifetime_fee_token_cost_units:'10000'}:{})},mandate:version===3?base.mandate:{...base.mandate,terms:{...base.mandate.terms,payment:{rail:'mpp',chain_id:4217,token_address:'0x20c0000000000000000000000000000000000000',payer_address:`0x${'11'.repeat(20)}`,treasury_address:`0x${'99'.repeat(20)}`,minimum_token_reserve_units:'5000000',fee_token_address:'0x20c0000000000000000000000000000000000000',minimum_fee_token_reserve_units:'1000000',max_fee_token_cost_units:'10000'}}}}
  const commands:unknown[]=[];let lose=true,denied=false
  await page.route(`**${api}**`,async route=>{
    if(denied)return route.fulfill({status:404,json:{error_code:'ORGANIZATION_ROUTE_NOT_FOUND'}})
    if(route.request().method()==='POST') {const command=route.request().postDataJSON();expect(command.version).toBe(version);commands.push(command);if(lose){lose=false;return route.abort('failed')}a.state='approved'}
    await route.fulfill({json:{authorization:a}})
  })
  await page.goto(url)
  await expect(page.getByRole('heading',{name:'Original private provider consent'})).toBeVisible()
  await expect(page.getByText(share.provider_owner_id,{exact:true})).toBeVisible();await expect(page.getByText(share.organization_owner_id,{exact:true})).toBeVisible();await expect(page.getByText(share.consent_hash,{exact:true})).toBeVisible()
  if(version===4)await expect(page.getByText('Lifetime fee ceiling (pathUSD base units)',{exact:true})).toBeVisible()
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Approve original route'}).click();await expect(page.getByRole('main').getByRole('alert')).toBeVisible()
  await page.reload();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Approve original route'}).click();await expect(page.getByText('Status: approved')).toBeVisible()
  expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  const saved=(await page.evaluate(()=>Object.values(sessionStorage))).join('');expect(saved).not.toContain(share.provider_owner_id);expect(saved).not.toContain(share.id);expect(saved).not.toContain('PRIVATE_REVIEW_SOURCE')
  denied=true;await page.getByRole('button',{name:'Refresh original review'}).click();await expect(page.getByRole('heading',{name:'Original private provider consent'})).toHaveCount(0);await expect(page.getByText(share.provider_owner_id,{exact:true})).toHaveCount(0)
})
