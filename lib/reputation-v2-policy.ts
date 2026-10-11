/** Initial deterministic choices. These are not empirically calibrated guarantees. */
export const REPUTATION_V2_POLICY = {
  event_schema_version: 1,
  evidence_eligibility_version: 2,
  aggregation_policy_version: 'reputation-v2-shadow-1',
  mode: 'shadow',
  half_life_days: 90,
  stale_after_days: 90,
  developing_groups: 5,
  developing_weight: 5,
  established_groups: 20,
  established_weight: 15,
  latency_minimum_p50: 10,
  latency_minimum_p95: 20,
  maximum_observations: 10000,
  ranking_quantile: 0.1,
  calibrated: false,
  buyer_independence: 'not_verified',
  serious_incident_expiry: 'no_automatic_expiry; explicit_superseding_adjudication_required',
  private_work: 'excluded_from_public_aggregation',
  scope_attribution: 'whole_job_acceptance; no_independent_component_quality',
} as const

export type ReputationScope = {
  kind: 'provider_history' | 'service_capability_mode'
  service_id?: string
  capability_id?: string
  execution_mode?: 'contracted' | 'instant'
  service_version?: string
}
