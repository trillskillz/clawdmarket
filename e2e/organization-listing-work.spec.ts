import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',listing='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',delivery='cccccccc-cccc-4ccc-8ccc-cccccccccccc',artifact='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const hash='e'.repeat(64),path=`/api/trades/${id}`,url=`/trades/${id}/listing-work`
const bytes=Buffer.from('PRIVATE_ORIGINAL_ARTIFACT <script>window.listingExecuted=true</script>')
const metadata={id:artifact,delivery_id:delivery,name:'original.txt',media_type:'text/plain',size_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}
function fixture(buyer=true){
  const acceptance={mode:'explicit_buyer',accepted:false,auto_confirm_enabled:false}
  const work={id:listing,viewer:{is_buyer:buyer,is_seller:!buyer},workspace:{trade:{id,buyer_id:'original-buyer',seller_id:'original-seller',status:'pending_release',payout_status:'pending'},
    reviewed_listing:{listing_id:listing,title:'Frozen original listing',description:'PRIVATE_ORIGINAL_REQUIREMENTS',requirements:{output_format:'json',acceptance_criteria:['Inspect exact original findings'],required_json_keys:['result'],minimum_sources:0}},
    delivery:{id:delivery,content_hash:hash,summary:'PRIVATE_ORIGINAL_DELIVERY',artifact:{result:'<script>window.listingExecuted=true</script>'},delivery_url:'https://untrusted.example.invalid/private-result'},acceptance}}
  const verification={trade_id:id,delivery:{id:delivery,content_hash:hash},acceptance,categories:{structure_verified:true,semantic_verified:false,buyer_accepted:false},artifacts:[metadata]}
  return {work,verification}
}
for(const width of [1440,390,320])test(`listing buyer reviews inert original artifacts and recovers a lost exact acceptance at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});const f=fixture(),bodies:unknown[]=[];let lose=true,denied=false,external=0
  page.on('request',request=>{if(request.url().startsWith('https://untrusted.example.invalid'))external++})
  await page.route(`**${path}/listing-work`,route=>route.fulfill(denied?{status:404,json:{error_code:'LISTING_WORK_NOT_FOUND'}}:{json:f.work}))
  await page.route(`**${path}/verification`,route=>route.fulfill({json:f.verification}))
  await page.route(`**${path}/artifacts/${artifact}`,route=>route.fulfill({body:bytes,headers:{'Content-Type':metadata.media_type,'Content-Length':String(bytes.length),'X-Artifact-SHA256':metadata.sha256}}))
  await page.route(`**${path}/confirm`,async route=>{
    bodies.push(route.request().postDataJSON());expect(bodies.at(-1)).toEqual({content_hash:hash})
    f.work.workspace.acceptance.accepted=true;f.work.workspace.trade.payout_status='processing'
    if(lose){lose=false;return route.abort('failed')}
    return route.fulfill({status:202,json:{ok:true,status:'settlement_processing'}})
  })
  await page.goto(url);await expect(page.getByText('PRIVATE_ORIGINAL_DELIVERY',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Accept exact delivery'})).toBeDisabled()
  await page.getByText('original.txt · digest checked').click();await expect(page.getByText(bytes.toString(),{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>Boolean((window as unknown as {listingExecuted?:boolean}).listingExecuted))).toBe(false);expect(external).toBe(0)
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Accept exact delivery'}).click()
  await expect(page.locator('main').getByRole('alert')).toContainText('may have committed');await expect(page.getByText('PRIVATE_ORIGINAL_DELIVERY',{exact:true})).toHaveCount(0)
  expect(bodies).toHaveLength(1)
  await page.getByRole('button',{name:'Refresh original state'}).click();await expect(page.getByRole('button',{name:'Resume original settlement'})).toBeDisabled()
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Resume original settlement'}).click()
  await expect(page.locator('main').getByRole('status')).toContainText('settlement is processing');expect(bodies).toEqual([{content_hash:hash},{content_hash:hash}])
  f.work.workspace.trade.status='completed';f.work.workspace.trade.payout_status='complete'
  await page.getByRole('button',{name:'Refresh original state'}).click();await expect(page.getByText('Status: completed · Settlement: complete')).toBeVisible();await expect(page.getByRole('checkbox')).toHaveCount(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  denied=true;await page.getByRole('button',{name:'Refresh original state'}).click();await expect(page.getByText('PRIVATE_ORIGINAL_DELIVERY',{exact:true})).toHaveCount(0)
  await expect(page.getByText('PRIVATE_ORIGINAL_REQUIREMENTS',{exact:true})).toHaveCount(0)
})
for(const width of [1440,390])test(`listing seller sees original private work without buyer settlement authority at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});const f=fixture(false)
  await page.route(`**${path}/listing-work`,route=>route.fulfill({json:f.work}));await page.route(`**${path}/verification`,route=>route.fulfill({json:{...f.verification,artifacts:[]}}))
  await page.goto(url);await expect(page.getByText('PRIVATE_ORIGINAL_DELIVERY',{exact:true})).toBeVisible();await expect(page.getByRole('checkbox')).toHaveCount(0)
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByText('PRIVATE_ORIGINAL_DELIVERY',{exact:true})).toHaveCount(0)
  await expect(page.locator('main').getByRole('alert')).toContainText('Refresh original state')
})
test('listing review refuses an altered artifact before exposing acceptance',async({page})=>{
  const f=fixture()
  await page.route(`**${path}/listing-work`,route=>route.fulfill({json:f.work}));await page.route(`**${path}/verification`,route=>route.fulfill({json:f.verification}))
  await page.route(`**${path}/artifacts/${artifact}`,route=>route.fulfill({body:bytes,headers:{'Content-Type':metadata.media_type,'Content-Length':String(bytes.length),'X-Artifact-SHA256':'0'.repeat(64)}}))
  await page.goto(url);await expect(page.locator('main').getByRole('alert')).toContainText('unavailable or changed');await expect(page.getByRole('checkbox')).toHaveCount(0)
})
