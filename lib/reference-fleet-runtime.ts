import { REFERENCE_FLEET_SLUGS, REFERENCE_FLEET_VERSION } from './reference-fleet-manifest'

export type ReferenceFleetRuntimeEntry = {
  slug: string
  agentId: string
  presenceKey: string
}

export function parseReferenceFleetRuntimeKeys(raw: string | undefined): ReferenceFleetRuntimeEntry[] {
  if (!raw?.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('REFERENCE_FLEET_KEYS_JSON is not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('REFERENCE_FLEET_KEYS_JSON must be an object')
  const document = parsed as Record<string, unknown>
  if (document.version !== REFERENCE_FLEET_VERSION) {
    throw new Error(`REFERENCE_FLEET_KEYS_JSON must use version ${REFERENCE_FLEET_VERSION}`)
  }
  if (!document.agents || typeof document.agents !== 'object' || Array.isArray(document.agents)) {
    throw new Error('REFERENCE_FLEET_KEYS_JSON.agents must be an object')
  }

  const entries: ReferenceFleetRuntimeEntry[] = []
  const agentIds = new Set<string>()
  const presenceKeys = new Set<string>()
  for (const [slug, value] of Object.entries(document.agents as Record<string, unknown>)) {
    if (!REFERENCE_FLEET_SLUGS.has(slug)) throw new Error(`Unknown reference fleet slug: ${slug}`)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Reference fleet entry ${slug} must be an object`)
    }
    const entry = value as Record<string, unknown>
    const agentId = typeof entry.agent_id === 'string' ? entry.agent_id.trim() : ''
    const presenceKey = typeof entry.presence_key === 'string' ? entry.presence_key.trim() : ''
    if (!/^(agent_|av_)[A-Za-z0-9-]{8,}$/.test(agentId)) {
      throw new Error(`Reference fleet entry ${slug} has an invalid agent_id`)
    }
    if (!/^clawd_[a-f0-9]{48}$/.test(presenceKey)) {
      throw new Error(`Reference fleet entry ${slug} has an invalid presence_key`)
    }
    if (agentIds.has(agentId)) throw new Error(`Reference fleet agent_id is duplicated: ${agentId}`)
    if (presenceKeys.has(presenceKey)) throw new Error('Reference fleet presence keys must be unique')
    agentIds.add(agentId)
    presenceKeys.add(presenceKey)
    entries.push({ slug, agentId, presenceKey })
  }
  return entries
}
