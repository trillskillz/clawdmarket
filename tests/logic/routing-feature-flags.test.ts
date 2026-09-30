import test from 'node:test'
import assert from 'node:assert/strict'
import { reusableServiceWritesEnabled, routePlanningEnabled } from '@/lib/routing-feature-flags'

test('new service and route writes are closed by default in production', () => {
  const env = process.env as Record<string, string | undefined>
  const prior = {
    node: process.env.NODE_ENV,
    services: process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED,
    planning: process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED,
  }
  try {
    env.NODE_ENV = 'production'
    delete process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED
    delete process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED
    assert.equal(reusableServiceWritesEnabled(), false)
    assert.equal(routePlanningEnabled(), false)
    process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED = 'true'
    process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED = 'true'
    assert.equal(reusableServiceWritesEnabled(), true)
    assert.equal(routePlanningEnabled(), true)
  } finally {
    if (prior.node === undefined) delete env.NODE_ENV
    else env.NODE_ENV = prior.node
    if (prior.services === undefined) delete process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED
    else process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED = prior.services
    if (prior.planning === undefined) delete process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED
    else process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED = prior.planning
  }
})
