import test from 'node:test'
import assert from 'node:assert/strict'
import { ClawdMarketClient, SDK_CONTRACT, type MilestoneContractDraftInput } from '../../sdk/typescript/src/index'

test('contract draft SDK rejects malformed saved references before HTTP and exposes no funding or reviewer scope', () => {
  let calls = 0
  const client = new ClawdMarketClient({ apiKey: 'disposable-buyer', fetch: async () => { calls++; throw new Error('Unexpected request') } })
  for (const reference of ['', 'short', 'invalid/reference', ' padded-ref ', 'a'.repeat(129)]) {
    assert.throws(() => client.recoverMilestoneContractCreation(reference), /client_reference/)
    assert.throws(() => client.createMilestoneContractDraft({ client_reference: reference, seller_id: 'seller',
      milestones: [{ title: 'Finite work', amount: 1 }] } satisfies MilestoneContractDraftInput), /client_reference/)
  }
  assert.equal(calls, 0)
  assert.equal(SDK_CONTRACT.operations.create_milestone_contract.path, '/api/contracts')
  assert.equal(SDK_CONTRACT.operations.create_milestone_contract.method, 'POST')
  assert.equal(SDK_CONTRACT.operations.create_milestone_contract.named_credential_scope, 'marketplace:write')
  assert.equal(SDK_CONTRACT.operations.list_milestone_contracts.method, 'GET')
  assert.equal(SDK_CONTRACT.operations.list_milestone_contracts.named_credential_scope, 'agent:read')
})

test('exact contract acceptance SDK rejects invalid identities and decisions before HTTP and uses separate read/payment scopes', () => {
  let calls = 0
  const client = new ClawdMarketClient({ apiKey: 'disposable-buyer', fetch: async () => { calls++; throw new Error('Unexpected request') } })
  const id = crypto.randomUUID(), milestone = crypto.randomUUID()
  const input = { version: 1 as const, client_reference: 'original-decision-reference', submission_id: crypto.randomUUID(), content_hash: 'a'.repeat(64), approve: true as const }
  for (const reference of ['', 'short', 'bad/reference']) {
    assert.throws(() => client.recoverOriginalContractAcceptance(id, milestone, reference), /client_reference/)
    assert.throws(() => client.acceptOriginalContractSubmission(id, milestone, { ...input, client_reference: reference }), /client_reference/)
    assert.throws(() => client.inspectOriginalContractSubmission(id, milestone, reference), /client_reference/)
  }
  for (const bad of ['bad-id', `${id}/escape`]) {
    assert.throws(() => client.inspectOriginalContractSubmission(bad, milestone), /UUID/)
    assert.throws(() => client.recoverOriginalContractAcceptance(id, bad, input.client_reference), /UUID/)
    assert.throws(() => client.acceptOriginalContractSubmission(id, milestone, { ...input, submission_id: bad }), /UUID/)
  }
  assert.throws(() => client.acceptOriginalContractSubmission(id, milestone, { ...input, content_hash: 'bad-hash' }), /exact contract acceptance/)
  assert.equal(calls, 0)
  assert.equal(SDK_CONTRACT.operations.get_original_contract_submission.named_credential_scope, 'agent:read')
  assert.equal(SDK_CONTRACT.operations.accept_original_contract_submission.named_credential_scope, 'payments:write')
  assert.equal(SDK_CONTRACT.operations.accept_original_contract_submission.method, 'PATCH')
})
