import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('a selected reviewer approves the exact private quote in the built app and the registered buyer consumes it once', async ({ request, page, context }) => {
  const registered = await request.post('/api/agents/register', { headers: { 'x-forwarded-for': `2001:db8:${(Date.now()%65535).toString(16)}::b54` },
    data: { name: `Purchase HTTP ${crypto.randomUUID().slice(0,8)}`, activation_mode: 'autonomous', capabilities: ['code-review'] } })
  expect(registered.status()).toBe(201); const agent = (await registered.json()).agent
  const fixture = (mode: string) => promisify(execFile)(process.execPath, ['--conditions=react-server','--import','tsx','e2e/fixtures/workflow-approval.ts',mode,agent.id],
    { env: { ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret' }, timeout:20000 })
  const owner = JSON.parse((await fixture('owners')).stdout), provider = JSON.parse((await fixture('service')).stdout)
  const headers = { Authorization: `Bearer ${owner.owner_key}` }, reviewerHeaders = { Authorization: `Bearer ${owner.outsider_key}` }
  const org = await request.post('/api/organizations', { headers,data:{ client_reference:crypto.randomUUID(),name:'Private purchasing approvals' } })
  expect(org.status()).toBe(201); const id = (await org.json()).organization.id, prefix = `/api/organizations/${id}/purchasing`
  expect((await request.put(`/api/organizations/${id}/agents`,{ headers,data:{agent_id:agent.id,cost_center:'ENGINEERING'} })).status()).toBe(200)
  const invitation = await request.post(`/api/organizations/${id}/invitations`, { headers,data:{client_reference:crypto.randomUUID(),target_account_id:`workflow-outsider-${agent.id}`} })
  expect(invitation.status()).toBe(201)
  const invitationId = (await invitation.json()).invitation_id
  expect((await request.post(`/api/organizations/invitations/${invitationId}/accept`, { headers:reviewerHeaders })).status()).toBe(200)
  const grant = await request.post(prefix+'/roles',{headers,data:{version:1,client_reference:crypto.randomUUID(),account_id:`workflow-outsider-${agent.id}`,
    team_id:null,role:'approver',max_purchase:'1.00',expires_at:new Date(Date.now()+3600_000).toISOString()}})
  expect(grant.status(),await grant.text()).toBe(201); const reviewerRole = (await grant.json()).role.id
  await fixture('purchasing-policy')
  const order = {client_reference:crypto.randomUUID(),objective:'Privately review the exact approved code',input:{private_code:'const answer = 42'},payment_rail:'evm',max_total:'1.00',expected_price:'0.95'}
  const buyerHeaders = {Authorization:`Bearer ${agent.api_key}`}
  const unapproved = await request.post(`/api/services/${provider.service}/orders`,{headers:buyerHeaders,data:order})
  expect(unapproved.status()).toBe(409); expect((await unapproved.json()).error_code).toBe('BUYER_APPROVAL_REQUIRED')
  const quote = await request.post(prefix+'/requests',{headers,data:{version:1,client_reference:crypto.randomUUID(),buyer_agent_id:agent.id,service_id:provider.service,
    requester_role_id:null,reviewer_role_id:reviewerRole,order,expires_at:new Date(Date.now()+1800_000).toISOString()}})
  expect(quote.status(),await quote.text()).toBe(201); const purchase = (await quote.json()).request, path = prefix+'/requests/'+purchase.id
  await context.addCookies([{name:'auth-token',value:owner.outsider_key,url:'http://localhost:3000'}, {name:'csrf-token',value:'browser-purchasing-csrf',url:'http://localhost:3000'}])
  await page.goto(`/organizations/${id}/purchasing/${purchase.id}`)
  await expect(page.getByRole('heading',{name:'Purchase review'})).toBeVisible()
  await expect(page.getByText('$1.00 USD',{exact:true})).toBeVisible()
  await page.getByText('Review exact private input and provider requirements').click()
  await expect(page.getByText('const answer = 42',{exact:false})).toBeVisible()
  await page.getByRole('button',{name:'Approve exact purchase'}).click()
  await expect(page.getByRole('status')).toHaveText('Purchase approved.')
  const inspected = await request.get(path,{headers}); expect(inspected.headers()['cache-control']).toContain('private, no-store')
  const saved = await inspected.json(), checkout = {...order,purchasing_approval_id:saved.approval.id}
  const created = await request.post(`/api/services/${provider.service}/orders`,{headers:buyerHeaders,data:checkout})
  expect(created.status(),await created.text()).toBe(201); const original = await created.json()
  await page.reload(); await expect(page.getByRole('link',{name:'the original purchase'})).toHaveAttribute('href',`/proof/${original.trade.id}`)
  expect((await request.delete(prefix+'/roles',{headers,data:{role_id:reviewerRole}})).status()).toBe(200)
  const replay = await request.post(`/api/services/${provider.service}/orders`,{headers:buyerHeaders,data:checkout})
  expect(replay.status()).toBe(200); expect((await replay.json()).order.id).toBe(original.order.id)
  await page.setViewportSize({width:390,height:844})
  await context.addCookies([{name:'auth-token',value:owner.owner_key,url:'http://localhost:3000'}]); await page.reload()
  await expect(page.getByRole('link',{name:'the original purchase'})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
})
