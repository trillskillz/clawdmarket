import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('A2A authenticated discovery and durable plan replay/cancellation use private canonical HTTP routes', async ({ request, playwright }) => {
 const ip=(Date.now()%65535).toString(16)
 const registered=await request.post('/api/agents/register',{headers:{'x-forwarded-for':`2001:db8:${ip}::a2a`},data:{name:`A2A HTTP ${randomUUID().slice(0,8)}`,description:'Isolated HTTP routing fixture',capabilities:['code-review'],activation_mode:'autonomous'}})
 expect(registered.status()).toBe(201)
 const agent=(await registered.json()).agent,headers={Authorization:`Bearer ${agent.api_key}`}
 async function rpc(method:string,params:unknown) {
  return request.post('/api/a2a',{headers,data:{jsonrpc:'2.0',id:randomUUID(),method,params}})
 }
 const publicCard=await request.get('/.well-known/agent-card.json');expect((await publicCard.json()).skills).toHaveLength(3)
 const card=await rpc('GetExtendedAgentCard',{});expect(card.status()).toBe(200);expect((await card.json()).result.skills).toHaveLength(5)
 const input={role:'ROLE_USER',messageId:randomUUID(),parts:[{mediaType:'application/json',data:{action:'route_work',request:{objective:'Review a private repository for authentication flaws',required_capabilities:['code-review'],max_budget:{amount:'0.01',currency:'USD'}}}}]}
 const created=await rpc('SendMessage',{message:input});expect(created.status()).toBe(200)
 const task=(await created.json()).result.task;expect(task.status.state).toBe('TASK_STATE_INPUT_REQUIRED')
 const data=task.artifacts[0].parts[0].data;expect(data.next_action).toBe('owner_authorize_then_continue');expect(data.funds_state).toBe('no_funds_moved')
 const replay=await rpc('SendMessage',{message:input});expect((await replay.json()).result.task.id).toBe(task.id)
 const owned=await request.get(`/api/routes/${data.route_id}`,{headers});expect(owned.status()).toBe(200);expect((await owned.json()).route.service_order_id).toBeNull()
 const inspect=await rpc('GetTask',{id:task.id,historyLength:0});expect(inspect.headers()['cache-control']).toContain('private, no-store')
 const anonymous=await playwright.request.newContext({baseURL:'http://localhost:3000'})
 try {expect((await anonymous.post('/api/a2a',{data:{jsonrpc:'2.0',id:1,method:'GetTask',params:{id:task.id}}})).status()).toBe(401)} finally {await anonymous.dispose()}
 const cancelled=await rpc('CancelTask',{id:task.id});expect(cancelled.status()).toBe(200);expect((await cancelled.json()).result.status.state).toBe('TASK_STATE_CANCELED')
 const listed=await rpc('ListTasks',{status:'TASK_STATE_CANCELED',includeArtifacts:true});const list=(await listed.json()).result;expect(list.totalSize).toBe(1);expect(list.tasks[0].id).toBe(task.id)
 const repeated=await rpc('CancelTask',{id:task.id});expect((await repeated.json()).result.status.state).toBe('TASK_STATE_CANCELED')
})
