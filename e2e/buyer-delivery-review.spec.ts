import { test, expect, type APIRequestContext } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { createPublicClient, createWalletClient, erc20Abi, http, type Address } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { evmPaymentProofMessage } from '../lib/evm-payment-message.mjs'
test.setTimeout(90_000)
test.beforeEach(() => test.skip(process.env.CLAWDMARKET_TEST_BUYER_ROUTE_CHAIN !== '1', 'Guarded actual-chain browser launcher required'))
async function delivered(request: APIRequestContext) {
  const id = crypto.randomUUID(), fixture = (mode: string) => promisify(execFile)(process.execPath,
    ['--conditions=react-server','--import','tsx','e2e/fixtures/buyer-route-recovery.ts',mode,id],
    {env:{...process.env,JWT_SECRET:process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret'},timeout:20_000})
  const accounts = JSON.parse((await fixture('setup')).stdout), headers = {Authorization:`Bearer ${accounts.buyerKey}`}
  const planned = await request.post('/api/routes/plan', {headers,data:{client_reference:`delivery-ui-${id}`,objective:'Review original private provider delivery',input:{private:'DELIVERY_PRIVATE_INPUT'},required_capabilities:['code-review'],
    max_budget:{amount:'1.00',currency:'USD'},payment_policy:{allowed_rails:['evm']},provider_requirements:{approved_providers:[accounts.seller]},verification:{required:true,methods:['buyer_review'],acceptance:{version:1,mode:'explicit_buyer'}}}})
  expect(planned.status()).toBe(201); const route = (await planned.json()).route, path = `/api/routes/${route.id}`
  const executed = await request.post(path + '/execute',{headers}); expect(executed.status()).toBe(201); const original = await executed.json()
  const account = privateKeyToAccount(`0x${'77'.repeat(32)}`), token = JSON.parse(process.env.EVM_ACCEPTED_TOKENS!)[0]
  const wallet = createWalletClient({chain:mainnet,account,transport:http(token.rpcUrl)}), chain = createPublicClient({chain:mainnet,transport:http(token.rpcUrl)})
  const balance = (address: Address) => chain.readContract({address:token.address,abi:erc20Abi,functionName:'balanceOf',args:[address]})
  const sellerAddress = `0x${'22'.repeat(20)}` as Address, sellerInitial = await balance(sellerAddress), buyerInitial = await balance(account.address)
  const fundingPath = `/api/trades/${original.trade.id}/fund/evm`
  const created = await request.post(fundingPath + '/intent',{headers,data:{chain_id:1,token_address:token.address,payer_address:account.address}})
  expect(created.status()).toBe(201); const intent = (await created.json()).intent
  const txHash = await wallet.writeContract({address:token.address,abi:erc20Abi,functionName:'transfer',args:[intent.treasury_address,BigInt(intent.token_amount)]})
  await chain.waitForTransactionReceipt({hash:txHash})
  const paid = await request.post(fundingPath,{headers,data:{intent_id:intent.id,chain_id:1,token_address:token.address,payer_address:account.address,tx_hash:txHash,payer_signature:await account.signMessage({message:evmPaymentProofMessage(intent,txHash)})}})
  expect(paid.status()).toBe(200)
  const sellerHeaders = {Authorization:`Bearer ${accounts.sellerKey}`}, text = '<script>globalThis.PRIVATE_REVIEW_EXECUTED = true</script> PRIVATE_DELIVERY_ARTIFACT'
  const artifactResponse = await request.post(`/api/trades/${original.trade.id}/artifacts`,{headers:sellerHeaders,data:{client_reference:`artifact-${id}`,name:'private-report.txt',media_type:'text/plain',content_base64:Buffer.from(text).toString('base64'),sha256:createHash('sha256').update(text).digest('hex')}})
  expect(artifactResponse.status()).toBe(201); const artifact = (await artifactResponse.json()).artifact
  const submitted = await request.post(`/api/trades/${original.trade.id}/delivery`,{headers:sellerHeaders,data:{summary:'PRIVATE_DELIVERY_SUMMARY <img src="https://delivery.example.invalid/leak">',artifact:{status:'done',private:'PRIVATE_DELIVERY_OUTPUT'},delivery_url:'https://delivery.example.invalid/remote',artifact_ids:[artifact.id]}})
  expect(submitted.status()).toBe(201); const delivery = (await submitted.json()).delivery
  const rpc = async (method: string, params: unknown[]) => { const response = await fetch(token.rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}); const value = await response.json(); expect(value.error).toBeUndefined(); return value.result }
  return {...accounts,headers,fixture,path,route,original,delivery,artifact,chain,rpc,balance,sellerAddress,sellerInitial,buyerInitial,account,intent}
}
const cookies = (key: string) => [{name:'auth-token',value:key,url:'http://localhost:3000'},{name:'csrf-token',value:'private-delivery-csrf',url:'http://localhost:3000'}]

test('actual provider delivery, lost committed buyer acceptance, pending payout and original backed completion survive desktop/mobile recovery', async ({request,page,context}) => {
  const f = await delivered(request); await context.addCookies(cookies(f.buyerKey))
  let remote = 0, accepts = 0, observes = 0
  page.on('request', incoming => { if (incoming.url().includes('delivery.example.invalid')) remote += 1 })
  await page.goto(`/routes/${f.route.id}`); await page.getByRole('link',{name:'Review original private delivery'}).click()
  const main = page.locator('main'), accept = main.getByRole('button',{name:'Accept exact original delivery'})
  await expect(accept).toBeDisabled(); await expect(main).toContainText(f.delivery.content_hash)
  await main.getByText('private-report.txt · size and SHA-256 checked',{exact:true}).click()
  await expect(main).toContainText('PRIVATE_DELIVERY_ARTIFACT'); expect(await page.evaluate(() => 'PRIVATE_REVIEW_EXECUTED' in globalThis)).toBe(false); expect(remote).toBe(0)
  expect((await context.request.post(f.path + '/advance',{data:{version:1,action:'accept',content_hash:f.delivery.content_hash}})).status()).toBe(403)
  await f.rpc('evm_setAutomine',[false])
  try {
    await page.route('**' + f.path + '/advance',async route => {
      if (route.request().method() !== 'POST') return route.continue()
      expect(route.request().postDataJSON()).toEqual({version:1,action:'accept',content_hash:f.delivery.content_hash}); accepts += 1
      const response = await route.fetch(); expect(response.status()).toBe(202); await route.abort('failed')
    })
    await main.getByRole('checkbox').check(); await accept.focus(); await page.keyboard.press('Enter')
    await expect(main.getByRole('alert')).toContainText('response was lost'); expect(accepts).toBe(1)
    await expect(main).not.toContainText('PRIVATE_DELIVERY_SUMMARY'); await page.unroute('**' + f.path + '/advance')
    await main.getByRole('button',{name:'Refresh original state'}).click(); await expect(main).toContainText('Work phase: settling')
    await expect(main).toContainText('Recorded acceptance: accepted'); await expect(accept).toHaveCount(0)
    await expect(main).toContainText('Capacity held'); await expect(main).toContainText('No backed route receipt is recorded')
    expect(await f.balance(f.sellerAddress)).toBe(f.sellerInitial)
  } finally { await f.rpc('evm_setAutomine',[true]); await f.rpc('evm_mine',[]) }
  const cron = await request.get('/api/cron/auto-confirm',{headers:{Authorization:`Bearer ${process.env.CRON_SECRET}`}}); expect(cron.status()).toBe(200)
  await main.getByRole('button',{name:'Refresh original state'}).click(); await expect(main).toContainText('Work phase: completed')
  await expect(main).toContainText('Capacity released'); await expect(main).toContainText('No backed route receipt is recorded')
  await page.route('**' + f.path + '/advance',async route => {
    if (route.request().method() !== 'POST') return route.continue()
    observes += 1; expect(route.request().postDataJSON()).toEqual({version:1,action:'observe'}); await route.continue()
  })
  await main.getByRole('button',{name:'Recover original accepted settlement'}).click()
  await expect(main.getByText('Original backed route receipt',{exact:true})).toBeVisible(); expect(observes).toBe(1); expect(accepts).toBe(1)
  await main.getByText('Original backed route receipt',{exact:true}).click(); await expect(main).toContainText('confirmed_external')
  const evidence = JSON.parse((await f.fixture('evidence')).stdout)
  expect(evidence.transfers).toHaveLength(1); expect(evidence.transfers[0].kind).toBe('seller_payout'); expect(evidence.transfers[0].status).toBe('confirmed'); expect(evidence.receipts).toHaveLength(1)
  expect(evidence.receipts[0].route_id).toBe(f.route.id); expect(await f.balance(f.sellerAddress)).toBe(f.sellerInitial + 950_000n)
  expect(await f.balance(f.account.address)).toBe(f.buyerInitial - BigInt(f.intent.token_amount)); expect(JSON.parse((await f.fixture('counts')).stdout)).toEqual({orders:1,trades:1,capacity:0})
  await page.screenshot({path:'/tmp/clawdmarket-delivery-review-desktop.png',fullPage:true}); await page.setViewportSize({width:390,height:844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({path:'/tmp/clawdmarket-delivery-review-mobile.png',fullPage:true}); expect(remote).toBe(0)
})

test('changed exact delivery hash conflicts without buyer decision, payout or capacity release', async ({request,page,context}) => {
  const f = await delivered(request); await context.addCookies(cookies(f.buyerKey)); const changed = 'd'.repeat(64)
  for (const path of [f.path + '/advance',f.path + '/result',`/api/trades/${f.original.trade.id}/verification`]) await page.route('**' + path,async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch(), body = await response.json(); body.delivery.content_hash = changed
    await route.fulfill({response,json:body})
  })
  await page.goto(`/routes/${f.route.id}/review`); const main = page.locator('main')
  await expect(main).toContainText(changed); await main.getByRole('checkbox').check()
  await main.getByRole('button',{name:'Accept exact original delivery'}).click(); await expect(main.getByRole('alert')).toContainText('Delivery or settlement changed')
  const original = await request.get(f.path + '/advance',{headers:f.headers}); const state = await original.json()
  expect(state.phase).toBe('awaiting_buyer'); expect(state.acceptance.accepted).toBe(false); expect(state.receipt).toBeNull()
  expect(JSON.parse((await f.fixture('counts')).stdout)).toEqual({orders:1,trades:1,capacity:1}); expect(JSON.parse((await f.fixture('evidence')).stdout)).toEqual({transfers:[],receipts:[]})
  expect(await f.balance(f.sellerAddress)).toBe(f.sellerInitial)
})

test('corrupt/unavailable artifact, stale read, account change and missing CSRF cannot grant private acceptance', async ({request,page,context}) => {
  const f = await delivered(request); await context.addCookies(cookies(f.buyerKey)); let posts = 0
  page.on('request', incoming => {if (incoming.method() === 'POST' && incoming.url().includes(f.path)) posts += 1})
  const artifactPath = `/api/trades/${f.original.trade.id}/artifacts/${f.artifact.id}`
  await page.route('**' + artifactPath,async route => {const response = await route.fetch(); await route.fulfill({response,body:Buffer.alloc(f.artifact.size_bytes)})})
  await page.goto(`/routes/${f.route.id}/review`); const main = page.locator('main'), accept = main.getByRole('button',{name:'Accept exact original delivery'})
  await expect(main.getByRole('alert')).toContainText('inspection is unavailable or changed'); await expect(accept).toHaveCount(0); await expect(main).not.toContainText('PRIVATE_DELIVERY_OUTPUT')
  await page.unroute('**' + artifactPath); await main.getByRole('button',{name:'Refresh original state'}).click(); await expect(accept).toBeDisabled()
  await main.getByRole('checkbox').check(); await page.clock.install(); await page.clock.fastForward(65_000)
  await expect(accept).toBeDisabled(); await expect(main.getByRole('alert')).toContainText('Inspection expired'); expect(posts).toBe(0); await page.clock.setSystemTime(new Date())
  await page.route('**' + f.path + '/result',route => route.fulfill({status:503,contentType:'application/json',body:'{"diagnostic":"PRIVATE_REVIEW_DIAGNOSTIC"}'}))
  await main.getByRole('button',{name:'Refresh original state'}).click(); await expect(main.getByRole('alert')).toContainText('inspection is unavailable'); await expect(main).not.toContainText('PRIVATE_REVIEW_DIAGNOSTIC'); expect(posts).toBe(0)
  await page.unroute('**' + f.path + '/result'); await context.addCookies(cookies(f.outsiderKey)); await main.getByRole('button',{name:'Refresh original state'}).click()
  await expect(main.getByRole('alert')).toContainText('original buyer account'); await expect(main).not.toContainText('PRIVATE_DELIVERY_SUMMARY')
  expect((await request.get(f.path + '/result',{headers:{Authorization:`Bearer ${f.outsiderKey}`}})).status()).toBe(404)
  expect((await request.get(artifactPath,{headers:{Authorization:`Bearer ${f.outsiderKey}`}})).status()).toBe(404)
  await context.addCookies(cookies(f.buyerKey)); await main.getByRole('button',{name:'Refresh original state'}).click(); await expect(accept).toBeDisabled()
  await context.clearCookies({name:'csrf-token'}); await main.getByRole('checkbox').check(); await accept.click()
  await expect(main.getByRole('alert')).toContainText('access and CSRF'); expect(posts).toBe(1)
  await context.clearCookies(); await main.getByRole('button',{name:'Refresh original state'}).click(); await expect(main.getByRole('alert')).toContainText('original buyer account')
  expect(JSON.parse((await f.fixture('evidence')).stdout)).toEqual({transfers:[],receipts:[]}); expect(JSON.parse((await f.fixture('counts')).stdout)).toEqual({orders:1,trades:1,capacity:1})
})
