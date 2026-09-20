import { REFERENCE_FLEET_SLUGS, REFERENCE_FLEET_VERSION } from './reference-fleet-manifest'

export type ReferenceFleetRuntimeEntry = {
  slug: string
  agentId: string
  presenceKey: string
}

export type ReferenceFleetExecutorRuntimeEntry = {
  slug: string
  agentId: string
  executorKey: string
}

type ParsedRuntimeEntry = ReferenceFleetRuntimeEntry & { executorKey: string | null }

function parseRuntimeDocument(raw: string | undefined): ParsedRuntimeEntry[] {
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

  const entries: ParsedRuntimeEntry[] = []
  const agentIds = new Set<string>()
  const presenceKeys = new Set<string>()
  const executorKeys = new Set<string>()
  for (const [slug, value] of Object.entries(document.agents as Record<string, unknown>)) {
    if (!REFERENCE_FLEET_SLUGS.has(slug)) throw new Error(`Unknown reference fleet slug: ${slug}`)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Reference fleet entry ${slug} must be an object`)
    }
    const entry = value as Record<string, unknown>
    const agentId = typeof entry.agent_id === 'string' ? entry.agent_id.trim() : ''
    const presenceKey = typeof entry.presence_key === 'string' ? entry.presence_key.trim() : ''
    const executorKey = typeof entry.executor_key === 'string' ? entry.executor_key.trim() : ''
    if (!/^(agent_|av_)[A-Za-z0-9-]{8,}$/.test(agentId)) {
      throw new Error(`Reference fleet entry ${slug} has an invalid agent_id`)
    }
    if (!/^clawd_[a-f0-9]{48}$/.test(presenceKey)) {
      throw new Error(`Reference fleet entry ${slug} has an invalid presence_key`)
    }
    if (executorKey && !/^clawd_[a-f0-9]{48}$/.test(executorKey)) {
      throw new Error(`Reference fleet entry ${slug} has an invalid executor_key`)
    }
    if (agentIds.has(agentId)) throw new Error(`Reference fleet agent_id is duplicated: ${agentId}`)
    if (presenceKeys.has(presenceKey)) throw new Error('Reference fleet presence keys must be unique')
    if (executorKey && executorKeys.has(executorKey)) throw new Error('Reference fleet executor keys must be unique')
    if (executorKeys.has(presenceKey) || (executorKey && presenceKeys.has(executorKey)) || executorKey === presenceKey) {
      throw new Error('Reference fleet presence and executor keys must be separate')
    }
    agentIds.add(agentId)
    presenceKeys.add(presenceKey)
    if (executorKey) executorKeys.add(executorKey)
    entries.push({ slug, agentId, presenceKey, executorKey: executorKey || null })
  }
  return entries
}

export function parseReferenceFleetRuntimeKeys(raw: string | undefined): ReferenceFleetRuntimeEntry[] {
  return parseRuntimeDocument(raw).map(({ slug, agentId, presenceKey }) => ({ slug, agentId, presenceKey }))
}

export function parseReferenceFleetExecutorKeys(raw: string | undefined): ReferenceFleetExecutorRuntimeEntry[] {
  return parseRuntimeDocument(raw).flatMap(({ slug, agentId, executorKey }) => executorKey
    ? [{ slug, agentId, executorKey }]
    : [])
}
