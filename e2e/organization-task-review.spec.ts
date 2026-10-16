import { test, expect } from '@playwright/test'
import type { OrganizationTaskAuthorization } from '../sdk/typescript/src/index'

const org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',task='legacy-original-task'
const api=`/api/organizations/${org}/task-authorizations/${id}`,url=`/organizations/${org}/task-authorizations/${id}`,key=`clawdmarket-task-review:${org}:${id}`
function authorization(tempo:boolean,role:'owner'|'reviewer'='reviewer'):OrganizationTaskAuthorization {
  return {id,version:tempo?2:1,organization_id:org,task_id:task,winning_bid_id:'original-bid',buyer_id:'user_agent_PRIVATE_ORIGINAL_BUYER',team_id:null,cost_center:'TASK-REVIEW',client_reference:'original-task-proposal',authority_hash:'a'.repeat(64),state:'pending',viewer_role:role,reviewer_account_id:'PRIVATE_REVIEWER',approved_at:null,revoked_at:null,review_url:url,decision:null,use:null,
    terms:{version:tempo?2:1,explicit_acceptance:true,task:{id:task,poster_agent_id:'PRIVATE_ORIGINAL_BUYER',title:'Review the original accepted task bid',description:'PRIVATE_TASK_REQUIREMENTS: inspect the original acceptance criteria and provider, then deliver the agreed structured output.',required_capabilities:['code-review'],budget_usd:1,deadline_at:new Date(Date.now()+600000).toISOString(),expires_at:null,task_type:'general',assigned_agent_id:'PRIVATE_ORIGINAL_PROVIDER',winning_bid_id:'original-bid'},
      bid:{id:'original-bid',agent_id:'PRIVATE_ORIGINAL_PROVIDER',price_usd:1,proposal:'PRIVATE_BID_PROPOSAL: deliver the original report without expanding the scope.',estimated_hours:1,counter_offer:{price:null,message:null,status:null}},workspace:{agreed_price:1,requirements:{output_format:'json',acceptance_criteria:['PRIVATE_ACCEPTANCE_CRITERION: review the exact original output.'],required_json_keys:['report'],minimum_sources:0}},
      payment:tempo?{rail:'mpp',chain_id:4217,token_address:`0x${'44'.repeat(20)}`,payer_address:`0x${'11'.repeat(20)}`,treasury_address:`0x${'99'.repeat(20)}`,minimum_token_reserve_units:'5000000',fee_token_address:`0x${'44'.repeat(20)}`,minimum_fee_token_reserve_units:'100000',max_fee_token_cost_units:'10000'}:
        {rail:'evm',chain_id:1,token_address:`0x${'44'.repeat(20)}`,payer_address:`0x${'11'.repeat(20)}`,treasury_address:`0x${'99'.repeat(20)}`,minimum_token_reserve_units:'5000000',minimum_native_reserve_wei:'1000000',max_gas_cost_wei:'10000000000000000'},
      token_decimals:6,token_usd_price:1,...(tempo?{fee_token_decimals:6}:{}),expires_at:new Date(Date.now()+600000).toISOString(),total_minor:105,max_daily_minor:105,max_monthly_minor:105,max_lifetime_minor:105,max_lifetime_chain_fee_units:tempo?'10000':'10000000000000000'}}
}
for(const tempo of [false,true])for(const width of [1440,390,320])test(`private task ${tempo?'Tempo v2':'L1 v1'} exact accepted bid and payment review survives lost decision at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});const a=authorization(tempo);let denied=false,lose=true,original:Record<string,unknown>|null=null
  await page.route(`**${api}**`,async route=>{
    if(denied)return route.fulfill({status:404,json:{error_code:'ORGANIZATION_TASK_NOT_FOUND'}})
    if(route.request().method()==='POST'){
      const body=route.request().postDataJSON();expect(body.version).toBe(tempo?2:1);expect(body.authority_hash).toBe(a.authority_hash);expect(body.approve).toBe(true)
      if(original)expect(body).toEqual(original);else original=body
      a.state='approved';a.decision=body
      if(lose){lose=false;return route.abort('failed')}
    }
    return route.fulfill({json:{authorization:a}})
  })
  await page.goto(url);await expect(page.getByRole('heading',{name:'Original accepted task',exact:true})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Original accepted bid',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Original delivery requirements',exact:true})).toBeVisible()
  await expect(page.getByText('PRIVATE_ORIGINAL_PROVIDER',{exact:true})).toBeVisible();await expect(page.getByText('$1.05 USD',{exact:true})).toBeVisible()
  await expect(page.getByText(tempo?'Per-payment fee ceiling (pathUSD base units)':'Per-payment gas ceiling (wei)',{exact:true})).toBeVisible()
  const approve=page.getByRole('button',{name:'Approve original task'});await expect(approve).toBeDisabled();await page.getByRole('checkbox').check();await approve.click()
  await expect(page.locator('main').getByRole('alert')).toContainText('Refresh');await expect(page.getByRole('heading',{name:'Original accepted task',exact:true})).toHaveCount(0)
  await page.reload();await expect(page.getByText('Status: approved')).toBeVisible()
  const stored=await page.evaluate(storageKey=>sessionStorage.getItem(storageKey),key);expect(JSON.parse(stored!)).toEqual(original)
  for(const secret of ['PRIVATE_TASK_REQUIREMENTS','PRIVATE_BID_PROPOSAL','PRIVATE_ORIGINAL_PROVIDER','PRIVATE_ACCEPTANCE_CRITERION','payer_address'])expect(stored).not.toContain(secret)
  // Explicit recovery reuses the saved decision; it never creates a replacement reference.
  a.state='pending';await page.getByRole('button',{name:'Refresh original review'}).click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Approve original task'}).click();await expect(page.getByText('Status: approved')).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  denied=true;await page.getByRole('button',{name:'Refresh original review'}).click();await expect(page.getByRole('heading',{name:'Original accepted task',exact:true})).toHaveCount(0);await expect(page.getByText('PRIVATE_ORIGINAL_PROVIDER',{exact:true})).toHaveCount(0)
})
for(const width of [1440,390])test(`task owner preserves independent approval and revokes only fresh spending at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});const a=authorization(false,'owner')
  await page.route(`**${api}**`,async route=>{if(route.request().method()==='DELETE')a.state='revoked';return route.fulfill({json:{authorization:a}})})
  await page.goto(url);await expect(page.getByRole('button',{name:'Approve original task'})).toHaveCount(0)
  await expect(page.getByText('The selected independent reviewer must approve this proposal.')).toBeVisible()
  await page.getByRole('button',{name:'Revoke fresh spending'}).click();await expect(page.getByText('Status: revoked')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Original payments, delivery and refunds remain recoverable')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
})
test('task review rejects a substituted saved decision and clears private scope on focus loss',async({page})=>{
  const a=authorization(false);let posts=0
  await page.route(`**${api}**`,async route=>{if(route.request().method()==='POST')posts++;return route.fulfill({json:{authorization:a}})})
  await page.goto(url);await expect(page.getByRole('heading',{name:'Original accepted task',exact:true})).toBeVisible()
  await page.evaluate(storageKey=>sessionStorage.setItem(storageKey,JSON.stringify({version:1,client_reference:'original-saved-decision',authority_hash:'b'.repeat(64),approve:true})),key)
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Approve original task'}).click()
  await expect(page.locator('main').getByRole('alert')).toContainText('saved decision differs');expect(posts).toBe(0)
  await page.getByRole('button',{name:'Refresh original review'}).click();await expect(page.getByRole('heading',{name:'Original accepted task',exact:true})).toBeVisible()
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('heading',{name:'Original accepted task',exact:true})).toHaveCount(0)
  await expect(page.locator('main').getByRole('alert')).toContainText('Refresh and sign in')
})
