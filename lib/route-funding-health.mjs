import { parseUnits } from 'viem'
const allSteps = '(SELECT id, mandate_id, route_id, order_id, trade_id, amount_minor, terms_hash, state, created_at, updated_at FROM route_funding_steps UNION ALL SELECT id, mandate_id, route_id, order_id, trade_id, amount_minor, terms_hash, state, created_at, updated_at FROM route_retry_funding_steps)'
/** Aggregate financial invariants only; never return account, route or payment values. */
export async function inspectRouteFundingHealth(client) {
  const [exposure, missing, steps, claims, mppClaims, retryRows] = await Promise.all([
    client.execute(`SELECT COUNT(*) AS count FROM route_payment_mandates m
      WHERE m.reserved_minor < 0 OR m.reserved_minor > m.max_aggregate_minor
      OR m.reserved_minor != COALESCE((SELECT SUM(s.amount_minor) FROM ${allSteps} s WHERE s.mandate_id = m.id), 0)`),
    client.execute(`SELECT COUNT(*) AS count FROM route_payment_mandates m JOIN route_plans r ON r.id = m.route_id
      WHERE r.service_order_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM ${allSteps} s WHERE s.route_id = r.id AND s.mandate_id = m.id AND s.order_id = r.service_order_id)`),
    client.execute(`SELECT
      COUNT(CASE WHEN s.state = 'reserved' AND t.status = 'pending' THEN 1 END) AS pending_count,
      COUNT(CASE WHEN s.state = 'reserved' AND t.status = 'pending' AND (m.state != 'active' OR m.expires_at <= unixepoch()) THEN 1 END) AS inactive_checkout_count,
      COUNT(CASE WHEN (s.state = 'funded' AND NOT EXISTS (SELECT 1 FROM payment_receipts p WHERE p.trade_id = s.trade_id))
        OR (s.state = 'reserved' AND EXISTS (SELECT 1 FROM payment_receipts p WHERE p.trade_id = s.trade_id)) THEN 1 END) AS proof_state_anomaly_count
      FROM ${allSteps} s JOIN route_payment_mandates m ON m.id = s.mandate_id JOIN trades t ON t.id = s.trade_id`),
    client.execute(`SELECT
      COUNT(CASE WHEN c.state = 'claimed' THEN 1 END) AS pending_claim_count,
      COUNT(CASE WHEN i.id IS NULL OR c.tx_hash != i.tx_hash OR i.tx_hash IS NULL
        OR c.chain_id != i.chain_id OR c.payer_address != i.payer_address
        OR s.id IS NULL OR c.mandate_id != s.mandate_id OR c.terms_hash != s.terms_hash
        OR (c.state = 'confirmed' AND NOT EXISTS (SELECT 1 FROM payment_receipts p WHERE p.trade_id = i.trade_id AND p.tx_hash = c.tx_hash AND p.payment_rail = 'evm'))
        OR (c.state = 'claimed' AND EXISTS (SELECT 1 FROM payment_receipts p WHERE p.trade_id = i.trade_id AND p.tx_hash = c.tx_hash AND p.payment_rail = 'evm'))
        THEN 1 END) AS payment_claim_anomaly_count
      FROM buyer_evm_payment_claims c LEFT JOIN evm_payment_intents i ON i.id = c.intent_id LEFT JOIN ${allSteps} s ON s.trade_id = i.trade_id`),
    client.execute(`SELECT
      COUNT(CASE WHEN c.state = 'claimed' THEN 1 END) AS pending_claim_count,
      COUNT(CASE WHEN i.id IS NULL OR s.id IS NULL OR c.mandate_id != i.mandate_id OR c.mandate_id != s.mandate_id
        OR c.chain_id != i.chain_id OR c.payer_address != i.payer_address OR c.terms_hash != i.terms_hash OR c.terms_hash != s.terms_hash
        OR (c.state = 'confirmed' AND NOT EXISTS (SELECT 1 FROM payment_receipts p WHERE p.trade_id = i.trade_id AND p.tx_hash = c.tx_hash AND p.payment_rail = 'mpp'
          AND p.chain_id = i.chain_id AND p.payer_address = i.payer_address AND p.token_address = i.token_address AND p.token_amount = i.token_amount))
        OR (c.state = 'claimed' AND EXISTS (SELECT 1 FROM payment_receipts p WHERE p.trade_id = i.trade_id AND p.tx_hash = c.tx_hash AND p.payment_rail = 'mpp'))
        THEN 1 END) AS payment_claim_anomaly_count
      FROM buyer_mpp_payment_claims c LEFT JOIN buyer_mpp_payment_intents i ON i.id = c.intent_id LEFT JOIN ${allSteps} s ON s.trade_id = i.trade_id`),
    client.execute(`SELECT s.id, s.route_id, s.order_id, s.trade_id, s.mandate_id, s.attempt_id, s.created_at,
      a.route_id AS attempt_route_id, a.service_order_id AS attempt_order_id,
      previous.route_id AS previous_route_id, previous.mandate_id AS previous_mandate_id,
      t.status AS previous_status, t.payout_status AS previous_payout, t.resolution, t.resolution_seller_percent,
      t.total_cost, t.seller_amount, t.buyer_id AS previous_buyer, current.buyer_id AS current_buyer,
      o.capacity_released_at, p.id AS proof_id, p.tx_hash AS funding_hash, p.token_amount AS funding_amount,
      p.token_decimals, p.token_usd_price, p.payer_address, p.chain_id, p.token_address,
      refund.status AS refund_status, refund.confirmed_at, refund.tx_hash AS refund_hash, refund.token_amount AS refund_amount,
      refund.chain_id AS refund_chain, refund.token_address AS refund_token, refund.to_address AS refund_destination,
      EXISTS(SELECT 1 FROM settlement_transfers payout WHERE payout.trade_id = s.previous_trade_id AND payout.kind = 'seller_payout') AS payout_exists
      FROM route_retry_funding_steps s LEFT JOIN route_attempts a ON a.id = s.attempt_id
      LEFT JOIN ${allSteps} previous ON previous.trade_id = s.previous_trade_id
      LEFT JOIN trades t ON t.id = s.previous_trade_id LEFT JOIN trades current ON current.id = s.trade_id
      LEFT JOIN service_orders o ON o.trade_id = t.id LEFT JOIN payment_receipts p ON p.trade_id = t.id
      LEFT JOIN settlement_transfers refund ON refund.trade_id = t.id AND refund.kind = 'buyer_refund'`),
  ])
  let retryAnomalies = 0
  for (const row of retryRows.rows) {
    try {
      const cancelled = row.previous_status === 'cancelled' && row.previous_payout === 'refunded'
      const resolved = row.previous_status === 'resolved' && row.previous_payout === 'complete' && row.resolution === 'buyer' && Number(row.resolution_seller_percent) === 0
      const expectedRefund = cancelled ? row.total_cost : row.seller_amount
      if ((!cancelled && !resolved) || row.previous_route_id !== row.route_id || row.previous_mandate_id !== row.mandate_id
        || row.attempt_route_id !== row.route_id || row.attempt_order_id !== row.order_id || row.previous_buyer !== row.current_buyer
        || row.capacity_released_at == null || Number(row.capacity_released_at) > Number(row.created_at)
        || row.proof_id == null || !/^0x[a-f0-9]{64}$/i.test(String(row.funding_hash)) || Number(row.token_usd_price) !== 1
        || row.funding_amount !== parseUnits(Number(row.total_cost).toFixed(2), Number(row.token_decimals)).toString()
        || Number(row.payout_exists) || row.refund_status !== 'confirmed' || row.confirmed_at == null || Number(row.confirmed_at) > Number(row.created_at)
        || !/^0x[a-f0-9]{64}$/i.test(String(row.refund_hash)) || row.refund_chain !== row.chain_id
        || String(row.refund_token).toLowerCase() !== String(row.token_address).toLowerCase()
        || String(row.refund_destination).toLowerCase() !== String(row.payer_address).toLowerCase()
        || row.refund_amount !== parseUnits(Number(expectedRefund).toFixed(2), Number(row.token_decimals)).toString()) retryAnomalies++
    } catch { retryAnomalies++ }
  }
  return { funded_retry_count: retryRows.rows.length, funded_retry_anomaly_count: retryAnomalies, pending_count: Number(steps.rows[0]?.pending_count || 0), inactive_checkout_count: Number(steps.rows[0]?.inactive_checkout_count || 0),
    exposure_anomaly_count: Number(exposure.rows[0]?.count || 0), missing_step_count: Number(missing.rows[0]?.count || 0), proof_state_anomaly_count: Number(steps.rows[0]?.proof_state_anomaly_count || 0),
    pending_claim_count: Number(claims.rows[0]?.pending_claim_count || 0) + Number(mppClaims.rows[0]?.pending_claim_count || 0),
    payment_claim_anomaly_count: Number(claims.rows[0]?.payment_claim_anomaly_count || 0) + Number(mppClaims.rows[0]?.payment_claim_anomaly_count || 0),
    pending_mpp_claim_count: Number(mppClaims.rows[0]?.pending_claim_count || 0), mpp_payment_claim_anomaly_count: Number(mppClaims.rows[0]?.payment_claim_anomaly_count || 0) }
}
