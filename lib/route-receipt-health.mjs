import { createHash } from 'node:crypto'
import { canonicalJSON } from '../scripts/verifier-contract.mjs'

/** Private rows stay inside this inspection; only invariant counts leave it. */
export async function inspectRouteReceiptHealth(client) {
  const [receipts, missing] = await Promise.all([
    client.execute(`SELECT r.route_id, r.trade_id, r.content_hash, r.receipt_json,
      p.state AS route_state, o.state AS order_state, o.capacity_released_at,
      t.status AS trade_state, t.payout_status, t.payment_rail, d.content_hash AS delivery_hash,
      f.tx_hash AS funding_hash, f.token_amount AS funding_amount, s.tx_hash AS payout_hash, s.token_amount AS payout_amount,
      s.status AS transfer_state, s.confirmed_at,
      EXISTS(SELECT 1 FROM transactions e WHERE e.reference_id = t.id AND e.type = 'escrow_release') AS release_exists,
      EXISTS(SELECT 1 FROM credit_entries e WHERE e.reference = t.id AND e.kind = 'settlement' AND e.user_id = t.buyer_id AND e.escrow_delta < 0) AS credit_settlement_exists,
      EXISTS(SELECT 1 FROM verification_results v WHERE v.trade_id = t.id AND v.delivery_id = d.id AND v.content_hash = d.content_hash AND v.method = 'buyer_review' AND v.status = 'passed') AS acceptance_exists
      FROM route_receipts r LEFT JOIN route_plans p ON p.id = r.route_id LEFT JOIN service_orders o ON o.id = p.service_order_id
      LEFT JOIN trades t ON t.id = r.trade_id LEFT JOIN trade_deliveries d ON d.trade_id = t.id
      LEFT JOIN payment_receipts f ON f.trade_id = t.id LEFT JOIN settlement_transfers s ON s.trade_id = t.id AND s.kind = 'seller_payout'`),
    client.execute(`SELECT COUNT(*) AS count FROM route_plans p JOIN service_orders o ON o.id = p.service_order_id
      JOIN trades t ON t.id = o.trade_id JOIN route_funding_steps step ON step.trade_id = t.id
      WHERE p.state = 'completed' AND t.status IN ('completed','complete') AND NOT EXISTS(SELECT 1 FROM route_receipts r WHERE r.route_id = p.id)`),
  ])
  let anomalyCount = 0
  for (const row of receipts.rows) {
    try {
      const receipt = JSON.parse(String(row.receipt_json))
      const actualHash = createHash('sha256').update(canonicalJSON(receipt)).digest('hex')
      let invalid = actualHash !== row.content_hash || receipt.version !== 1 || receipt.route_id !== row.route_id || receipt.trade_id !== row.trade_id
        || receipt.settlement_status !== 'completed' || receipt.capacity_released !== true || receipt.delivery?.content_hash !== row.delivery_hash
        || receipt.buyer_decision?.content_hash !== row.delivery_hash || receipt.buyer_decision?.decision !== 'accepted'
        || row.route_state !== 'completed' || row.order_state !== 'completed' || row.capacity_released_at == null
        || !['completed', 'complete'].includes(row.trade_state) || row.payout_status !== 'complete' || !Number(row.acceptance_exists)
      if (['evm', 'mpp'].includes(row.payment_rail)) invalid ||= receipt.financial?.kind !== 'confirmed_external'
        || receipt.financial.funding?.tx_hash !== row.funding_hash || receipt.financial.funding?.token_amount !== row.funding_amount
        || receipt.financial.payout?.tx_hash !== row.payout_hash || receipt.financial.payout?.token_amount !== row.payout_amount
        || row.transfer_state !== 'confirmed' || row.confirmed_at == null
      else invalid ||= !Number(row.release_exists) || row.payment_rail === 'credit' && (!Number(row.credit_settlement_exists) || receipt.financial?.kind !== 'backed_account_credit')
      if (invalid) anomalyCount++
    } catch { anomalyCount++ }
  }
  return { receipt_count: receipts.rows.length, completed_without_receipt_count: Number(missing.rows[0]?.count || 0), receipt_anomaly_count: anomalyCount }
}
