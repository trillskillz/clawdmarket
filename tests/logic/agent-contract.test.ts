import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { GET as getOpenApi } from '@/app/api/docs/route'
import {
  AGENT_ACTIONS,
  AGENT_CONTRACT_VERSION,
  getAgentManifest,
  getAgentOpenApiPaths,
  getClientRecoveryContract,
  renderSkillMd,
  renderLlmsTxt,
} from '@/lib/agent-contract'
import { getRequestOrigin } from '@/lib/request-origin'
import { CAPABILITY_FAMILIES } from '@/lib/capability-hierarchy'

function endpointPath(endpoint: string) {
  return endpoint.split('?')[0]
}

test('department budget operations remain owner-only and do not delegate purchasing authority', () => {
  const actions = getAgentManifest().actions
  for (const id of ['inspect_team_budget', 'set_team_budget']) {
    const action = actions.find((entry) => entry.id === id)!
    assert.equal(action.auth, 'owner-account')
    assert.equal(action.endpoint, '/api/organizations/{id}/teams/{teamId}/budget')
    assert.ok(action.required?.includes('teamId'))
    assert.equal(action.payment, null)
  }
  const paths = getAgentOpenApiPaths() as Record<string, Record<string, { operationId: string; parameters: { name: string }[] }>>
  assert.equal(paths['/api/organizations/{id}/teams/{teamId}/budget'].put.operationId, 'set_team_budget')
  assert.deepEqual(paths['/api/organizations/{id}/teams/{teamId}/budget'].put.parameters.map((entry) => entry.name), ['id', 'teamId'])
})

test('marketplace reputation advertises bounded owner feedback and history confidence without independent quality claims', () => {
  const evidence = getAgentManifest().marketplace_reputation
  assert.equal(evidence.feedback, 'latest_eligible_rating_per_current_buyer_owner_principal')
  assert.equal(evidence.confidence_scope, 'marketplace_history_breadth')
  assert.equal(evidence.buyer_independence, 'not_verified')
  assert.equal(evidence.measured_quality_score, null)
  assert.equal(evidence.calibrated, false)
  assert.equal(evidence.circular_trade_policy.edges, 'currently_backed_buyer_accepted_trades')
  assert.deepEqual(getClientRecoveryContract().marketplace_reputation, evidence)
  const paths = getAgentOpenApiPaths() as Record<string, { get: Record<string, unknown> }>
  assert.deepEqual(paths['/api/agents/{id}/trust'].get['x-reputation-evidence'], evidence)
  assert.deepEqual(paths['/api/listings'].get['x-reputation-evidence'], evidence)
  for (const text of [renderSkillMd(), renderLlmsTxt()]) assert.match(text, /Marketplace reputation: ratings require the actual buyer and seller/)
})

test('Python verifier discovery and report schemas agree on finite external checks with mandatory buyer acceptance', () => {
  const manifest = getAgentManifest()
  assert.deepEqual(manifest.isolated_verification.adapters, ['javascript_tests_v1', 'javascript_static_v1', 'python_tests_v1'])
  assert.equal(manifest.isolated_verification.explicit_buyer_acceptance_required, true)
  assert.equal(manifest.isolated_verification.isolation_observed_by_app, false)
  assert.equal(manifest.isolated_verification.semantic_verified, false)
  assert.deepEqual(getClientRecoveryContract().isolated_verification, manifest.isolated_verification)
  const action = manifest.actions.find((entry) => entry.id === 'submit_verification_report')!
  const report = action.body_schema as { properties: { adapter: { enum: readonly string[] } } }
  assert.deepEqual(report.properties.adapter.enum, manifest.isolated_verification.adapters)
})

test('completion proof advertises the exact bounded cycle scope without claiming buyer independence', () => {
  const evidence = getAgentManifest().capability_evidence
  assert.equal(evidence.circular_trade_policy.max_cycle_length, 4)
  assert.equal(evidence.circular_trade_policy.max_search_states, 256)
  assert.equal(evidence.circular_trade_policy.search_exhausted, 'exclude_completion_evidence')
  assert.equal(evidence.circular_trade_policy.edges, 'currently_backed_buyer_accepted_service_completions')
  assert.equal(evidence.circular_trade_policy.longer_cycles, 'not_resolved')
  assert.equal(evidence.independence, 'not_verified')
  assert.equal(evidence.quality_score, null)
  assert.deepEqual(getClientRecoveryContract().capability_evidence.circular_trade_policy, evidence.circular_trade_policy)
})

test('versioned observations advertise finite grading and scopes without measured quality or inherited authority', () => {
  const benchmark = getAgentManifest().trusted_benchmarks
  assert.equal(benchmark.adapter, 'json_exact_v1')
  assert.equal(benchmark.grader_authority, 'allowlisted_registered_agent')
  assert.equal(benchmark.grant_seconds, 600)
  assert.equal(benchmark.evidence.measured_quality_score, null)
  assert.equal(benchmark.evidence.independence, 'not_verified')
  assert.equal(benchmark.evidence.calibrated, false)
  assert.equal(benchmark.evidence.routing_eligible, false)
  const operations = getClientRecoveryContract().operations
  assert.equal(operations.publish_benchmark_definition.named_credential_scope, null)
  assert.equal(operations.retire_benchmark_definition.named_credential_scope, null)
  for (const operation of ['create_benchmark_run', 'submit_benchmark_outputs', 'report_benchmark_run', 'cancel_benchmark_run']) assert.equal(operations[operation].named_credential_scope, 'agent:write')
  assert.equal(operations.inspect_benchmark_run.named_credential_scope, 'agent:read')
})

test('family discovery advertises explicit navigation IDs without granting purchase or evidence inheritance', () => {
  const manifest = getAgentManifest()
  assert.deepEqual(manifest.capability_hierarchy.family_ids, CAPABILITY_FAMILIES.map(({ id }) => id))
  assert.equal(manifest.capability_hierarchy.matching.purchase, 'exact_canonical_leaves')
  assert.equal(manifest.capability_hierarchy.matching.evidence, 'exact_canonical_leaves')
  assert.equal(manifest.capability_hierarchy.matching.sibling_inheritance, false)
  const paths = getAgentOpenApiPaths() as Record<string, Record<string, any>>
  for (const path of ['/api/agents/list', '/api/agents/search', '/api/services']) {
    assert.deepEqual(paths[path].get.parameters.find((parameter: { name: string }) => parameter.name === 'family').schema.enum, manifest.capability_hierarchy.family_ids)
    assert.ok(paths[path].get.responses[400])
  }
  assert.ok(manifest.discovery.capability_hierarchy.endsWith('/api/capabilities/hierarchy'))
  assert.ok(renderSkillMd().includes('family query'))
})

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
  assert.equal(document.paths['/api/agents/briefing'].get.operationId, 'get_briefing')
  assert.equal(document.paths['/api/a2a'].post.operationId, 'a2a_jsonrpc')
  assert.ok(document.paths['/api/a2a'].post.requestBody.content['application/json'].schema.properties.method.enum.includes('GetExtendedAgentCard'))
  assert.equal(document.paths['/api/routes/metrics'].get.operationId, 'inspect_route_metrics')
  assert.equal(document.paths['/api/workflows/plan'].post.operationId, 'plan_workflow')
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

test('machine manifest advertises the subscribed provider work event', () => {
  const manifest = getAgentManifest()
  assert.equal(manifest.version, AGENT_CONTRACT_VERSION)
  assert.ok(manifest.webhook_events.includes('work_order.ready'))
  assert.equal(manifest.a2a.owner_mandate_required, true)
  assert.equal(manifest.a2a.wallet_broadcast, false)
  assert.deepEqual(manifest.a2a.authenticated_write_skills, ['route_work', 'cancel_route'])
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
  assert.match(skill, /Marketplace trades support `credit`, `mpp`, and `evm` payment rails/)
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
  assert.match(skill, /GET \/api\/agents\/briefing/)
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

test('instant contract separates metered prepaid authority, asynchronous calls and atomic result receipts', () => {
 const manifest=getAgentManifest();assert.equal(manifest.instant_execution.metering,'one_successful_call');assert.equal(manifest.instant_execution.contracted_trade_created,false);assert.equal(manifest.instant_execution.enabled_by_default_in_production,false)
 const paths=getAgentOpenApiPaths() as Record<string, any>
 const open=paths['/api/instant/services/{id}/sessions'].post
 assert.equal(open.requestBody.content['application/json'].schema.properties.payment_rail.const,'credit')
 assert.equal(open.requestBody.content['application/json'].schema.properties.acceptance.const,'schema_v1')
 assert.equal(open.requestBody.content['application/json'].schema.properties.budget_minor.maximum,10000)
 assert.ok(paths['/api/instant/sessions/{id}/calls'].post.responses[202])
 assert.match(renderSkillMd(),/not semantic quality or an on-chain per-call transfer/)
})


test('purchasing contract separates exact participant approvals from owner grants and buyer payment credentials', () => {
  const paths = getAgentOpenApiPaths() as Record<string, any>
  for (const id of ['request_service_purchase','approve_service_purchase','inspect_service_purchase']) {
    const action = AGENT_ACTIONS.find(item=>item.id===id)!;assert.equal(action.auth,'organization-purchaser-account')
    assert.ok(paths[action.endpoint])
  }
  assert.equal(AGENT_ACTIONS.find(item=>item.id==='grant_purchasing_role')!.auth,'owner-account')
  const order = paths['/api/services/{id}/orders'].post.requestBody.content['application/json'].schema
  assert.equal(order.properties.purchasing_approval_id.format,'uuid')
  const quote = paths['/api/organizations/{id}/purchasing/requests'].post.requestBody.content['application/json'].schema
  assert.deepEqual(quote.properties.order.properties.payment_rail.enum,['credit','evm','mpp'])
  assert.match(renderSkillMd(),/Only the approval threshold is satisfied; all other policy checks still apply/)
  assert.match(renderSkillMd(),/One approval creates one original order\/trade/)
})
