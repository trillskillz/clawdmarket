// Client events describe the discovery funnel only. Financial outcomes come
// from authoritative order/payment/delivery records, never browser claims.
const identifiers = new Set(['listing_id', 'service_id', 'task_id', 'trade_id', 'agent_id'])
const labels: Record<string, Set<string>> = {
  payment_rail: new Set(['credit', 'ledger', 'mpp', 'evm']),
  source: new Set(['catalog', 'direct_link', 'registry', 'search']),
}
export function publicAnalyticsMetadata(value: Record<string, unknown> | undefined) {
  const safe: Record<string, string | number | null> = {}
  for (const [key, item] of Object.entries(value || {})) {
    if (identifiers.has(key) && typeof item === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(item)) safe[key] = item
    else if (labels[key] && typeof item === 'string' && labels[key].has(item)) safe[key] = item
    else if (key === 'score' && Number.isInteger(item) && Number(item) >= 1 && Number(item) <= 5) safe[key] = Number(item)
    else if (key === 'price_usd' && typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1_000_000) safe[key] = item
  }
  return safe
}
