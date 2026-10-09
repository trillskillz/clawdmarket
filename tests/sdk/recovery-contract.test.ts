import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AGENT_CONTRACT_VERSION, getAgentManifest, getAgentOpenApiPaths, getClientRecoveryContract, renderLlmsTxt, renderSkillMd } from '@/lib/agent-contract'
import { SDK_CONTRACT } from '../../sdk/typescript/src/contract'
import { ClawdMarketApiError, ClawdMarketClient, ClawdMarketTimeoutError, ClawdMarketTransportError, verifyWebhookSignature } from '../../sdk/typescript/src/index'
import { createHmac } from 'node:crypto'
import { GET as legacyManifest } from '@/app/.well-known/agent.json/route'
import { GET as paymentManifest } from '@/app/.well-known/mpp.json/route'

const id = '00000000-0000-4000-8000-000000000001'

test('compatibility identity schema covers all advertised rails and MPP descriptor preserves free routing tools', async () => {
  const legacy = await (await legacyManifest()).json()
  const identitySchema = JSON.parse(readFileSync('public/agent-spec.json', 'utf8'))
  assert.deepEqual(legacy.payment_methods.map((method: { protocol: string }) => method.protocol).sort(), [...SDK_CONTRACT.payment_rails].sort())
  assert.deepEqual(identitySchema.properties.payment_methods.items.properties.protocol.enum.sort(), [...SDK_CONTRACT.payment_rails].sort())
  const payment = await (await paymentManifest()).json()
  assert.deepEqual(payment.endpoints.find((endpoint: { path: string }) => endpoint.path === '/api/mcp').free_tools, getAgentManifest().mcp_free_tools)
})

test('both generated clients agree with canonical operations, auth, scopes, lifecycle, rails and deprecations', () => {
  const contract = getClientRecoveryContract()
  assert.deepEqual(SDK_CONTRACT, contract)
  assert.deepEqual(JSON.parse(readFileSync('sdk/python/clawdmarket/contract.json', 'utf8')), contract)
  const paths = getAgentOpenApiPaths() as Record<string, Record<string, { operationId: string }>>
  for (const [name, operation] of Object.entries(contract.operations)) assert.equal(paths[operation.path]?.[operation.method.toLowerCase()]?.operationId, name)
  assert.equal(contract.operations.fund_trade_mpp.named_credential_scope, 'payments:write')
  assert.equal(contract.operations.disable_webhook.named_credential_scope, 'agent:write')
  assert.equal(contract.operations.upload_artifact.named_credential_scope, 'marketplace:write')
  assert.ok(contract.operations.create_service.deprecated_body_fields.includes('price_bankr'))
  const manifest = getAgentManifest()
  assert.deepEqual(manifest.client_recovery, contract.recovery)
  assert.deepEqual(manifest.mcp_protocol, contract.mcp)
  assert.deepEqual(manifest.a2a, contract.a2a)
  for (const guide of [renderLlmsTxt(), renderSkillMd()]) {
    assert.ok(guide.includes(`Client recovery (contract ${AGENT_CONTRACT_VERSION})`))
    assert.ok(guide.includes('GET /api/webhooks/deliveries'))
    assert.ok(guide.includes('funds_state=unknown'))
  }
})

test('webhook recovery follows canonical authenticated work and never follows notification URLs', async () => {
  const calls: string[] = []
  const client = new ClawdMarketClient({ apiKey: 'dummy-recovery-key', fetch: async (url, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer dummy-recovery-key')
    assert.equal(init?.redirect, 'error')
    calls.push(`${init?.method} ${new URL(String(url)).pathname}`)
    return Response.json({ ok: true, webhooks: [], deliveries: [], total: 0, work_order: {}, order: {} })
  } })
  await client.listWebhooks(); await client.getWebhookDeliveries(); await client.getWorkOrder(id); await client.getServiceOrder(id); await client.disableWebhook(id)
  assert.deepEqual(calls, ['GET /api/webhooks', 'GET /api/webhooks/deliveries', `GET /api/trades/${id}/work-order`, `GET /api/service-orders/${id}`, `DELETE /api/webhooks/${id}`])
  assert.throws(() => client.disableWebhook('../redirect'), /UUID/)
})

test('funding recovery retains original proof, pending refunds and signing challenge details', async () => {
  const proof = { tx_hash: `0x${'11'.repeat(32)}`, payer_address: `0x${'22'.repeat(20)}` }
  let calls = 0
  const client = new ClawdMarketClient({ apiKey: 'dummy-key', fetch: async (_url, init) => {
    calls++; assert.deepEqual(JSON.parse(String(init?.body)), proof)
    return calls === 1 ? Response.json({ ok: true, status: 'late_payment_refund_processing', trade: { id, status: 'cancelled', payout_status: 'processing' } }, { status: 202 })
      : Response.json({ code: 'PAYER_AUTHORIZATION_REQUIRED', message: 'Sign this exact saved payment', tx_hash: proof.tx_hash, funds_state: 'payment_unknown', retryable: true }, { status: 428, headers: { 'Retry-After': '12' } })
  } })
  assert.equal((await client.verifyBuyerMppFunding(id, proof)).status, 'late_payment_refund_processing')
  await assert.rejects(client.verifyBuyerMppFunding(id, proof), (error: unknown) => {
    assert.ok(error instanceof ClawdMarketApiError)
    assert.equal(error.payload.tx_hash, proof.tx_hash)
    assert.equal(error.fundsState, 'payment_unknown'); assert.equal(error.retryAfterSeconds, 12)
    return true
  })
  assert.equal(calls, 2)
})

test('uncertain artifact upload is replayed only by the caller with the original reference and exact body', async () => {
  const bodies: string[] = []
  const client = new ClawdMarketClient({ apiKey: 'dummy-key', fetch: async (_url, init) => {
    bodies.push(String(init?.body))
    if (bodies.length === 1) throw new Error('lost response after commit')
    return Response.json({ artifact: { id }, idempotent: true })
  } })
  const upload = { client_reference: 'saved-upload-reference', name: 'result.txt', media_type: 'text/plain' as const, content_base64: 'aGk=', sha256: 'dummy' }
  await assert.rejects(client.uploadArtifact(id, upload), ClawdMarketTransportError)
  assert.equal(bodies.length, 1)
  assert.equal((await client.uploadArtifact(id, upload)).idempotent, true)
  assert.equal(bodies[0], bodies[1])
})

test('poll deadline bounds an in-flight fetch and preserves read-only financial uncertainty', async () => {
  let calls = 0
  const client = new ClawdMarketClient({ apiKey: 'dummy-key', fetch: async (_url, init) => {
    calls++
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }))
  } })
  await assert.rejects(client.waitForRoute(id, { timeoutMs: 30 }), (error: unknown) => {
    assert.ok(error instanceof ClawdMarketTimeoutError)
    assert.equal(error.lastState, null); assert.equal(error.fundsState, 'unknown'); return true
  })
  assert.equal(calls, 1)
})

test('webhook HMAC authenticates exact raw bytes, including Unicode, before parsing or deduplication', async () => {
  const body = JSON.stringify({ delivery_id: id, event: 'work_order.ready', data: { label: 'résumé' } })
  const signature = `sha256=${createHmac('sha256', 'dummy-webhook-secret').update(body).digest('hex')}`
  assert.equal(await verifyWebhookSignature('dummy-webhook-secret', new TextEncoder().encode(body), signature), true)
  assert.equal(await verifyWebhookSignature('dummy-webhook-secret', `${body} `, signature), false)
  assert.equal(await verifyWebhookSignature('wrong-secret', body, signature), false)
  assert.equal(await verifyWebhookSignature('dummy-webhook-secret', body, signature.toUpperCase()), false)
  assert.equal(await verifyWebhookSignature('', body, signature), false)
})
