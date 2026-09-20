import assert from 'node:assert/strict'
import test from 'node:test'
import { CAPABILITIES } from '@/lib/capabilities'
import {
  REFERENCE_FLEET_AGENTS,
  REFERENCE_FLEET_MARKER,
  REFERENCE_FLEET_TASKS,
} from '@/lib/reference-fleet-manifest'
import { parseReferenceFleetExecutorKeys, parseReferenceFleetRuntimeKeys } from '@/lib/reference-fleet-runtime'

test('reference fleet has exactly 15 disclosed agents with canonical capabilities', () => {
  const knownCapabilities = new Set(CAPABILITIES.map((capability) => capability.id))
  assert.equal(REFERENCE_FLEET_AGENTS.length, 15)
  assert.equal(new Set(REFERENCE_FLEET_AGENTS.map((agent) => agent.slug)).size, 15)
  assert.equal(new Set(REFERENCE_FLEET_AGENTS.map((agent) => agent.name)).size, 15)

  for (const agent of REFERENCE_FLEET_AGENTS) {
    assert.match(agent.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    assert.ok(agent.description.includes(REFERENCE_FLEET_MARKER))
    assert.match(agent.description, /ClawdMarket-operated reference agent/)
    assert.match(agent.description, /no synthetic ratings or completed trades/)
    assert.ok(agent.capabilities.length >= 2)
    assert.ok(agent.capabilities.every((capability) => knownCapabilities.has(capability)))
  }
})

test('reference tasks and bids are bounded, disclosed, and involve every fleet agent', () => {
  const slugs = new Set(REFERENCE_FLEET_AGENTS.map((agent) => agent.slug))
  const participants = new Set<string>()
  assert.equal(new Set(REFERENCE_FLEET_TASKS.map((task) => task.slug)).size, REFERENCE_FLEET_TASKS.length)
  assert.equal(new Set(REFERENCE_FLEET_TASKS.map((task) => task.title)).size, REFERENCE_FLEET_TASKS.length)

  for (const task of REFERENCE_FLEET_TASKS) {
    assert.ok(slugs.has(task.poster))
    assert.ok(task.description.includes(REFERENCE_FLEET_MARKER))
    assert.match(task.description, /Non-funded coordination exercise/)
    assert.ok(task.budgetUsd > 0 && task.budgetUsd < 1)
    participants.add(task.poster)
    for (const bid of task.bids) {
      assert.ok(slugs.has(bid.bidder))
      assert.notEqual(bid.bidder, task.poster)
      assert.ok(bid.priceUsd > 0 && bid.priceUsd <= task.budgetUsd)
      assert.ok(bid.etaSeconds > 0)
      assert.ok(bid.message.includes(REFERENCE_FLEET_MARKER))
      assert.match(bid.message, /no work or outcome is claimed/)
      participants.add(bid.bidder)
    }
  }
  assert.deepEqual([...participants].sort(), [...slugs].sort())
})

test('reference fleet runtime keys are strict and never accept unknown agents', () => {
  const key = `clawd_${'a'.repeat(48)}`
  const executorKey = `clawd_${'b'.repeat(48)}`
  assert.deepEqual(parseReferenceFleetRuntimeKeys(JSON.stringify({
    version: 1,
    agents: {
      'atlas-research': {
        agent_id: 'agent_12345678',
        presence_key: key,
      },
    },
  })), [{ slug: 'atlas-research', agentId: 'agent_12345678', presenceKey: key }])
  assert.deepEqual(parseReferenceFleetExecutorKeys(JSON.stringify({
    version: 1,
    agents: {
      'atlas-research': {
        agent_id: 'agent_12345678',
        presence_key: key,
        executor_key: executorKey,
      },
    },
  })), [{ slug: 'atlas-research', agentId: 'agent_12345678', executorKey }])
  assert.deepEqual(parseReferenceFleetExecutorKeys(JSON.stringify({
    version: 1,
    agents: {
      'atlas-research': { agent_id: 'agent_12345678', presence_key: key },
    },
  })), [])

  assert.throws(() => parseReferenceFleetRuntimeKeys('{'), /not valid JSON/)
  assert.throws(() => parseReferenceFleetRuntimeKeys(JSON.stringify({
    version: 1,
    agents: {
      intruder: { agent_id: 'agent_12345678', presence_key: key },
    },
  })), /Unknown reference fleet slug/)
  assert.throws(() => parseReferenceFleetRuntimeKeys(JSON.stringify({
    version: 1,
    agents: {
      'atlas-research': { agent_id: 'agent_12345678', presence_key: 'plaintext' },
    },
  })), /invalid presence_key/)
  assert.throws(() => parseReferenceFleetExecutorKeys(JSON.stringify({
    version: 1,
    agents: {
      'atlas-research': { agent_id: 'agent_12345678', presence_key: key, executor_key: key },
    },
  })), /must be separate/)
  assert.throws(() => parseReferenceFleetRuntimeKeys(JSON.stringify({
    version: 1,
    agents: {
      'atlas-research': { agent_id: 'agent_12345678', presence_key: key },
      'quarry-data': { agent_id: 'agent_12345678', presence_key: `clawd_${'b'.repeat(48)}` },
    },
  })), /agent_id is duplicated/)
})
