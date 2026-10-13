import { test, expect } from '@playwright/test'
const org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const api=`/api/organizations/${org}/workflow-authorizations/${id}`,url=`/organizations/${org}/workflow-authorizations/${id}`
function authorization(tempo:boolean,role:'owner'|'reviewer'='reviewer'){
 const nodes=['source','review'].map(key=>({key,required_capabilities:['code-review'],depends_on:key==='review'?['source']:[],budget_minor:105,deadline_seconds:key==='source'?300:600}))
 return {id,version:tempo?2:1,organization_id:org,authority_hash:'a'.repeat(64),state:'pending',viewer_role:role,buyer_id:'private-buyer',team_id:null,cost_center:'WORKFLOW',approval_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',decision:null as null|Record<string,unknown>,
  terms:{max_daily_minor:210,max_monthly_minor:210,max_lifetime_minor:210,max_lifetime_chain_fee_units:tempo?'20000':'20000000000000000',nodes:nodes.map((n,i)=>({key:n.key,candidates:[{service_id:`service-${i}`,pricing:{estimated_total:'1.05'},explanation:['Original contracted provider.'],eligibility:{approval_required:true}}],provider_shares:[{id:`share-${i}`,service_id:`service-${i}`,organization_owner_id:'PRIVATE_ORGANIZATION_OWNER',provider_owner_id:`PRIVATE_PROVIDER_OWNER_${i}`,team_id:null,expires_at:new Date(Date.now()+900000).toISOString(),consent_hash:'c'.repeat(64)}]}))},
  contract:{workflow:{objective:'Review two original dependent private objectives',nodes},terms:{max_gross_minor:210,max_chain_fee_units:tempo?'20000':'20000000000000000',expires_at:new Date(Date.now()+600000).toISOString(),payment:{rail:tempo?'mpp':'evm',chain_id:tempo?4217:1,token_address:`0x${'44'.repeat(20)}`,payer_address:`0x${'11'.repeat(20)}`,treasury_address:`0x${'99'.repeat(20)}`,minimum_token_reserve_units:'5000000',...(tempo?{fee_token_address:`0x${'44'.repeat(20)}`,minimum_fee_token_reserve_units:'100000',max_fee_token_cost_units:'10000'}:{minimum_native_reserve_wei:'1000000',max_gas_cost_wei:'10000000000000000'})},nodes:nodes.map(n=>({key:n.key,static_input:{secret:`PRIVATE_WORKFLOW_${n.key}`},max_per_attempt_minor:105,max_chain_fee_per_attempt_units:tempo?'10000':'10000000000000000',max_latency_seconds:60,provider_requirements:{approved_providers:['original-provider']},verification:{required:true,methods:['schema','buyer_review'],acceptance:{version:1,mode:'explicit_buyer'}},dependency_inputs:n.key==='review'?[{source_node:'source',artifact_index:0,target_field:'upstream'}]:[]}))}}}
}
for(const tempo of [false,true])for(const width of [1440,390])test(`private workflow ${tempo?'Tempo v2':'L1 v1'} exact graph and consent review survives lost decision at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});const a=authorization(tempo);let denied=false,lose=true,original:Record<string,unknown>|null=null
 await page.route(`**${api}**`,async route=>{
  if(denied)return route.fulfill({status:404,json:{error_code:'ORGANIZATION_WORKFLOW_NOT_FOUND'}})
  if(route.request().method()==='POST'){
   const body=route.request().postDataJSON();expect(body.version).toBe(tempo?2:1);expect(body.authority_hash).toBe(a.authority_hash)
   if(original)expect(body).toEqual(original);else original=body
   a.state='approved';a.decision=body
   if(lose){lose=false;return route.abort('failed')}
  }
  return route.fulfill({json:{authorization:a}})
 })
 await page.goto(url);await expect(page.getByRole('heading',{name:'Original workflow graph'})).toBeVisible()
 const checkboxBounds=await page.getByRole('checkbox').boundingBox();expect(checkboxBounds).not.toBeNull();expect(checkboxBounds!.width).toBeGreaterThanOrEqual(16);expect(checkboxBounds!.width).toBeLessThanOrEqual(24);expect(checkboxBounds!.height).toBeLessThanOrEqual(24)
 await expect(page.getByText('source artifact 0 → upstream')).toBeVisible();await expect(page.getByText('PRIVATE_PROVIDER_OWNER_1',{exact:true})).toBeVisible()
 const approve=page.getByRole('button',{name:'Approve original workflow'});await expect(approve).toBeDisabled();await page.getByRole('checkbox').check();await approve.click()
 await expect(page.locator('main').getByRole('alert')).toContainText('Refresh');await page.reload();await expect(page.getByText('Status: approved')).toBeVisible()
 const stored=await page.evaluate(()=>Object.values(sessionStorage).join(''));expect(stored).not.toContain('PRIVATE_WORKFLOW');expect(stored).not.toContain('PRIVATE_PROVIDER_OWNER');expect(stored).not.toContain('share-');expect(JSON.parse(stored)).toEqual(original)
 // Explicit replay uses the saved identity even when the first reply was lost.
 a.state='pending';await page.getByRole('button',{name:'Refresh original review'}).click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Approve original workflow'}).click();await expect(page.getByText('Status: approved')).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
 denied=true;await page.getByRole('button',{name:'Refresh original review'}).click();await expect(page.getByRole('heading',{name:'Original workflow graph'})).toHaveCount(0);await expect(page.getByText('PRIVATE_PROVIDER_OWNER_1',{exact:true})).toHaveCount(0)
})
test('workflow owner inspection preserves independent reviewer approval and revokes fresh children',async({page})=>{
 const a=authorization(false,'owner');await page.route(`**${api}**`,async route=>{if(route.request().method()==='DELETE')a.state='revoked';return route.fulfill({json:{authorization:a}})})
 await page.goto(url);await expect(page.getByRole('button',{name:'Approve original workflow'})).toHaveCount(0);await page.getByRole('button',{name:'Revoke fresh spending'}).click();await expect(page.getByText('Status: revoked')).toBeVisible()
})
