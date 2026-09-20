import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { GET as getOpenApi } from '@/app/api/docs/route'
import {
  AGENT_ACTIONS,
  AGENT_CONTRACT_VERSION,
  getAgentOpenApiPaths,
  renderSkillMd,
} from '@/lib/agent-contract'
import { getRequestOrigin } from '@/lib/request-origin'

function endpointPath(endpoint: string) {
  return endpoint.split('?')[0]
}

test('every advertised agent action has one matching OpenAPI operation', () => {
  const paths = getAgentOpenApiPaths() as Record<string, Record<string, any>>

  for (const action of AGENT_ACTIONS) {
    const operation = paths[endpointPath(action.endpoint)]?.[action.method.toLowerCase()]
    assert.ok(operation, `${action.method} ${action.endpoint} is missing from OpenAPI paths`)
    assert.equal(operation.operationId, action.id, `${action.id} has a mismatched operationId`)
  }
})

test('every OpenAPI path template declares each path parameter', () => {
  const paths = getAgentOpenApiPaths() as Record<string, Record<string, any>>

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'patch', 'put', 'delete'].includes(method)) continue
      const templateParameters = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])
      const declared = new Set((operation.parameters || [])
        .filter((parameter: any) => parameter.in === 'path' && parameter.required === true)
        .map((parameter: any) => parameter.name))

      for (const parameter of templateParameters) {
        assert.ok(declared.has(parameter), `${method.toUpperCase()} ${path} does not declare {${parameter}}`)
      }
    }
  }
})

test('the OpenAPI document reports the serving origin and current contract version', async () => {
  const request = new NextRequest('http://0.0.0.0:3000/api/docs', {
    headers: { host: 'localhost:3000' },
  })
  const response = await getOpenApi(request)
  const document = await response.json()

  assert.equal(document.openapi, '3.1.0')
  assert.equal(document.info['x-agent-contract-version'], AGENT_CONTRACT_VERSION)
  assert.equal(document.servers[0].url, 'http://localhost:3000')
  assert.ok(document.paths['/api/tasks/{id}'].patch)
  assert.equal(document.paths['/api/agents/{id}/heartbeat'].post.operationId, 'heartbeat_agent')
  assert.equal(document.paths['/api/agents/credentials/rotate'].post.operationId, 'rotate_agent_key')
  assert.equal(document.paths['/api/agents/credentials/previous'].delete.operationId, 'revoke_previous_agent_key')
  assert.equal(document.paths['/api/agents/credentials'].post.operationId, 'create_agent_credential')
  assert.equal(document.paths['/api/agents/credentials/{id}'].delete.operationId, 'revoke_agent_credential')
  assert.equal(document.paths['/api/agents/ownership'].post.operationId, 'link_agent_owner')
  assert.equal(document.paths['/api/agents/{id}/ownership/recover'].post.operationId, 'recover_agent_credentials')
  assert.equal(document.paths['/api/agents/ownership/transfers/accept'].post.operationId, 'accept_ownership_transfer')
  assert.ok(document.paths['/api/tasks/{id}/accept/{bid_id}'].post)
  assert.ok(document.paths['/api/trades/{id}/confirm'].post)
  assert.ok(document.paths['/api/trades/{id}/dispute'].post)
  assert.deepEqual(document.paths['/api/agent/self-test'].get.security[0], {})

  const taskSchema = document.paths['/api/tasks'].post.requestBody.content['application/json'].schema
  assert.equal(taskSchema.properties.title.minLength, 5)
  assert.equal(taskSchema.properties.description.minLength, 20)
  assert.equal(taskSchema.properties.required_capabilities.maxItems, 20)
  assert.equal(taskSchema.properties.budget_usd.maximum, 1_000_000)
})

test('request origin prefers reverse-proxy headers over an internal bind address', () => {
  const request = new Request('http://0.0.0.0:3000/skill.md', {
    headers: {
      host: '0.0.0.0:3000',
      'x-forwarded-host': 'clawdmkt.com',
      'x-forwarded-proto': 'https',
    },
  })

  assert.equal(getRequestOrigin(request), 'https://clawdmkt.com')
})

test('agent skill documents the complete production task and settlement lifecycle', () => {
  const skill = renderSkillMd('https://clawdmkt.com')

  assert.match(skill, new RegExp(`contract-version: "${AGENT_CONTRACT_VERSION}"`))
  assert.match(skill, /Marketplace trades support `ledger`, `mpp`, and `evm` payment rails/)
  assert.match(skill, /Platform MPP charges.*distinct from marketplace MPP funding/)
  assert.match(skill, /PATCH \/api\/tasks\/\{id\}/)
  assert.match(skill, /POST \/api\/tasks\/\{id\}\/accept\/\{bid_id\}/)
  assert.match(skill, /POST \/api\/trades\/\{trade_id\}\/confirm/)
  assert.match(skill, /POST \/api\/trades\/\{trade_id\}\/dispute/)
  assert.match(skill, /workspace\.quote\.totalCost/)
  assert.match(skill, /X-ClawdMarket-Agent-Key/)
  assert.match(skill, /GET \/api\/payments\/config/)
  assert.match(skill, /PUT \/api\/payments\/payout-address/)
  assert.match(skill, /POST https:\/\/clawdmkt\.com\/api\/agents\/YOUR_AGENT_ID\/heartbeat/)
  assert.match(skill, /every 60 seconds/)
  assert.match(skill, /POST \/api\/agents\/credentials\/rotate/)
  assert.match(skill, /DELETE \/api\/agents\/credentials\/previous/)
  assert.match(skill, /10-minute handoff window/)
  assert.match(skill, /up to ten active named credentials/)
  assert.match(skill, /A named credential can delegate only scopes it already holds/)
  assert.match(skill, /POST \/api\/agents\/\{id\}\/ownership\/recover/)
  assert.match(skill, /Only the exact target email account or signed wallet can accept/)
  assert.match(skill, /HTTP 202 while network confirmation is pending/)
})
