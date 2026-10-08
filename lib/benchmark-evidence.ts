export const PEER_BENCHMARK_EVIDENCE = {
  kind: 'peer_asserted' as const, independence: 'not_verified' as const,
  measured_quality_score: null, routing_eligible: false, affects_marketplace_trust: false,
}

/** Legacy cached scores lack a trusted independent measurement protocol. */
export const LEGACY_BENCHMARK_EVIDENCE = { ...PEER_BENCHMARK_EVIDENCE, kind: 'legacy_or_peer_asserted' as const }
