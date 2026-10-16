const kinds = new Set(['configuration', 'rpc', 'treasury_reserves', 'settlement_worker', 'payout_refund_anomalies', 'paid_canary', 'independent_customer_activity'])

/** Separate evidence slots prevent a health poll from changing economic proof.
 * This composes operator records; it never creates settlement or canary proof. */
export function updateOperationalEvidence(current, observation) {
  if (!kinds.has(observation?.kind) || !['observed', 'unavailable', 'not_demonstrated'].includes(observation.status)
    || !Number.isFinite(Date.parse(observation.checked_at)) || typeof observation.source !== 'string' || !observation.source) throw new Error('INVALID_OPERATIONAL_EVIDENCE')
  if (observation.kind === 'paid_canary' && observation.status === 'observed'
    && (!observation.original_trade_id || !/^0x[a-f0-9]{64}$/i.test(observation.funding_tx_hash || '')
      || !/^0x[a-f0-9]{64}$/i.test(observation.payout_tx_hash || '') || !/^[a-f0-9]{64}$/i.test(observation.accepted_delivery_hash || '')
      || observation.cohort !== 'platform_canary')) throw new Error('PAID_CANARY_PROOF_REFERENCES_REQUIRED')
  return { ...current, [observation.kind]: { ...observation } }
}
