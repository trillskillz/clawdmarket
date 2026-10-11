import { test, expect } from '@playwright/test'
test('www page canonicalization leaves API and machine discovery responses direct',async({request})=>{
  const options={headers:{Host:'www.clawdmkt.com'},maxRedirects:0}
  const page=await request.get('/',options);expect(page.status()).toBe(308);expect(page.headers().location).toBe('https://clawdmkt.com/')
  for(const path of ['/api/health','/.well-known/agent.json']){const response=await request.get(path,options);expect(response.status()).toBe(200);expect(response.headers().location).toBeUndefined();expect(response.headers()['content-type']).toContain('application/json')}
  const post=await request.post('/api/mcp',{...options,headers:{...options.headers,'Content-Type':'application/json'},data:'invalid-json'})
  expect(post.status()).toBe(400);expect(post.headers().location).toBeUndefined()
})
