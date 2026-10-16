export function providerConcentration(ids: string[], providerForService: Map<string, string>) {
  const providers = new Map<string, number>()
  let unknown = 0
  for (const id of ids) {
    const provider = providerForService.get(id)
    if (!provider) { unknown++; continue }
    providers.set(provider, (providers.get(provider) || 0) + 1)
  }
  return { positions: ids.length, distinct_providers: providers.size, unknown_provider_positions: unknown,
    largest_provider_share: ids.length && !unknown ? Math.max(0, ...providers.values()) / ids.length : null }
}

export function rankPositionChanges(ids: string[], baseline: string[]) {
  return ids.filter((id, index) => id !== baseline[index]).length
}
