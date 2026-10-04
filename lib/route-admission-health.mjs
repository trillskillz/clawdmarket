import { inspectRouteFundingHealth } from './route-funding-health.mjs'
import { inspectRouteReceiptHealth } from './route-receipt-health.mjs'
import { inspectCreditHealth } from './credit-health.mjs'
/** Aggregate-only financial audit, shared by transactional controls and protected read-only monitoring. */
export async function inspectRouteAdmissionHealth(client) {
  const [funding, receipts, credit, pending] = await Promise.all([
    inspectRouteFundingHealth(client), inspectRouteReceiptHealth(client), inspectCreditHealth(client),
    client.execute(`SELECT
      (SELECT COUNT(*) FROM (SELECT state, created_at FROM buyer_evm_payment_claims UNION ALL SELECT state, created_at FROM buyer_mpp_payment_claims)
        WHERE state = 'claimed' AND created_at < unixepoch() - 900) AS stale_claims,
      (SELECT COUNT(*) FROM settlement_transfers transfer WHERE
        (transfer.status = 'failed' OR (transfer.status IN ('pending','signing','prepared','submitted') AND transfer.updated_at < unixepoch() - 900))
        AND EXISTS(SELECT 1 FROM service_orders o JOIN route_attempts a ON a.service_order_id = o.id WHERE o.trade_id = transfer.trade_id)) AS uncertain_transfers,
      (SELECT COUNT(*) FROM route_plans r JOIN service_orders o ON o.id = r.service_order_id JOIN trades t ON t.id = o.trade_id
        WHERE r.state = 'completed' AND t.status IN ('completed','complete') AND t.completed_at < unixepoch() - 900
        AND EXISTS(SELECT 1 FROM route_payment_mandates m WHERE m.route_id = r.id)
        AND NOT EXISTS(SELECT 1 FROM route_receipts receipt WHERE receipt.route_id = r.id)) AS missing_receipts`),
  ])
  const conditions = [
    ['ROUTE_EXPOSURE_INVARIANT', funding.exposure_anomaly_count], ['ROUTE_FUNDING_LINK_INVARIANT', funding.missing_step_count],
    ['ROUTE_FUNDING_PROOF_INVARIANT', funding.proof_state_anomaly_count], ['ROUTE_PAYMENT_CLAIM_INVARIANT', funding.payment_claim_anomaly_count],
    ['ROUTE_RETRY_INVARIANT', funding.funded_retry_anomaly_count], ['ROUTE_RECEIPT_INVARIANT', receipts.receipt_anomaly_count],
    ['ACCOUNT_CREDIT_INVARIANT', !credit.healthy], ['ROUTE_PAYMENT_UNCONFIRMED', Number(pending.rows[0]?.stale_claims || 0)],
    ['ROUTE_TRANSFER_UNCERTAIN', Number(pending.rows[0]?.uncertain_transfers || 0)], ['ROUTE_RECEIPT_MISSING', Number(pending.rows[0]?.missing_receipts || 0)],
  ]
  const alerts = conditions.filter(([, value]) => !!value).map(([code, value]) => ({ code, count: typeof value === 'boolean' ? 1 : value, severity: 'critical' }))
  return { healthy: alerts.length === 0, alerts, checked_at: new Date().toISOString(), stale_after_seconds: 900 }
}
