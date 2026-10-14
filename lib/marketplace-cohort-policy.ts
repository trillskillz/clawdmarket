import { parseReferenceFleetRuntimeKeys } from './reference-fleet-runtime'
import { FALLBACK_AGENTS } from './fallback-agents'

export const MARKETPLACE_COHORTS = ['platform_reference', 'platform_demo', 'platform_canary', 'ownership_unverified', 'independence_verified'] as const
export type MarketplaceCohort = typeof MARKETPLACE_COHORTS[number]

/** Operator runtime configuration is authoritative for currently managed IDs.
 * Return only principal IDs; credentials must never enter public DTOs or logs.
 * Persist reviewed attributions before retiring an identity from this manifest. */
export function runtimeReferencePrincipals(): Set<string> {
  return new Set([...FALLBACK_AGENTS.flatMap(agent => [agent.id, `user_agent_${agent.id}`]), ...parseReferenceFleetRuntimeKeys(process.env.REFERENCE_FLEET_KEYS_JSON).map(entry => `user_agent_${entry.agentId}`)])
}

export function runtimeCanaryPrincipals(): Set<string> {
  // Scoped rollout identifies canary activity, not ownership. Exclude it from
  // independent economics without classifying its principals as platform-owned.
  const values = [process.env.CLAWDMARKET_ROUTE_CANARY_BUYER_ID, process.env.CLAWDMARKET_ROUTE_CANARY_SELLER_ID]
  return new Set(values.flatMap(value => {
    const id = value?.trim()
    return id && /^[A-Za-z0-9_:-]{1,200}$/.test(id) ? [id] : []
  }))
}

export function runtimeReferenceExclusionSql(buyer: string, seller: string) {
  const ids = [...new Set([...runtimeReferencePrincipals(), ...runtimeCanaryPrincipals()])]
  if (!ids.length) return '1=1'
  // The runtime parser validates agent IDs; quote defensively as well. Caller
  // expressions are internal SQL identifiers, never request parameters.
  const literals = ids.map(id => `'${id.replaceAll("'", "''")}'`).join(',')
  return `(${buyer} NOT IN (${literals}) AND ${seller} NOT IN (${literals}))`
}
