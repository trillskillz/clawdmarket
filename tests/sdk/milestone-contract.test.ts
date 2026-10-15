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
