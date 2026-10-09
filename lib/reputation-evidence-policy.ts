import { CAPABILITY_CYCLE_POLICY } from './capability-cycle-policy'

export const REPUTATION_EVIDENCE_POLICY = {
  version: 1, scope: 'current_backed_buyer_accepted_marketplace_history',
  feedback: 'latest_eligible_rating_per_current_buyer_owner_principal',
  confidence_scope: 'marketplace_history_breadth', calibrated: false,
  buyer_independence: 'not_verified', measured_quality_score: null,
  positive_evidence_weight: 'at_most_one_completion_and_rating_per_buyer_principal',
  negative_outcomes: 'retained_separately',
  circular_trade_policy: { ...CAPABILITY_CYCLE_POLICY, edges: 'currently_backed_buyer_accepted_trades' },
} as const
