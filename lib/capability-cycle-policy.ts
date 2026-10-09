/** A bounded observation filter, never proof of buyer independence. */
export const CAPABILITY_CYCLE_POLICY = {
  version: 1, max_cycle_length: 4, max_search_states: 256,
  edges: 'currently_backed_buyer_accepted_service_completions',
  principals: 'current_authoritative_owner_or_account',
  search_exhausted: 'exclude_completion_evidence',
  longer_cycles: 'not_resolved', independence: 'not_verified',
} as const
