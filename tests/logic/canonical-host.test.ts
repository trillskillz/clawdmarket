import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
test('canonical HTML host preserves direct API and machine discovery paths on the existing www alias',async()=>{
  const config=require('../../next.config.js'),{pathToRegexp}=require('next/dist/compiled/path-to-regexp'),rules=await config.redirects()
  const hostRule=rules.find((rule:any)=>rule.has?.some((condition:any)=>condition.type==='host'&&condition.value==='www.clawdmkt.com'))
  assert.equal(hostRule.destination,'https://clawdmkt.com/:path*');assert.equal(hostRule.permanent,true)
  const pattern=pathToRegexp(hostRule.source)
  for(const path of ['/','/marketplace','/registry/example','/apiculture','/api-like','/proof/original'])assert.equal(pattern.test(path),true,path)
  for(const path of ['/api','/api/health/ready','/api/trades/original/fund/mpp','/api/mcp','/.well-known','/.well-known/agent.json'])assert.equal(pattern.test(path),false,path)
})
