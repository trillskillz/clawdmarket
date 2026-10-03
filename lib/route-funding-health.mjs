/** Aggregate financial invariants only; never return account, route or payment values. */
export async function inspectRouteFundingHealth(client) {
  const [exposure, missing, steps] = await Promise.all([
    client.execute(`SELECT COUNT(*) AS count FROM route_payment_mandates m
      WHERE m.reserved_minor < 0 OR m.reserved_minor > m.max_aggregate_minor
      OR m.reserved_minor != COALESCE((SELECT SUM(s.amount_minor) FROM route_funding_steps s WHERE s.mandate_id = m.id), 0)`),
    client.execute(`SELECT COUNT(*) AS count FROM route_payment_mandates m JOIN route_plans r ON r.id = m.route_id
      WHERE r.service_order_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM route_funding_steps s WHERE s.route_id = r.id AND s.mandate_id = m.id AND s.order_id = r.service_order_id)`),
    client.execute(`SELECT
      COUNT(CASE WHEN s.state = 'reserved' AND t.status = 'pending' THEN 1 END) AS pending_count,
      COUNT(CASE WHEN s.state = 'reserved' AND t.status = 'pending' AND (m.state != 'active' OR m.expires_at <= unixepoch()) THEN 1 END) AS inactive_checkout_count,
      COUNT(CASE WHEN (s.state = 'funded' AND NOT EXISTS (SELECT 1 FROM payment_receipts p WHERE p.trade_id = s.trade_id))
        OR (s.state = 'reserved' AND EXISTS (SELECT 1 FROM payment_receipts p WHERE p.trade_id = s.trade_id)) THEN 1 END) AS proof_state_anomaly_count
      FROM route_funding_steps s JOIN route_payment_mandates m ON m.id = s.mandate_id JOIN trades t ON t.id = s.trade_id`),
  ])
  return { pending_count: Number(steps.rows[0]?.pending_count || 0), inactive_checkout_count: Number(steps.rows[0]?.inactive_checkout_count || 0),
    exposure_anomaly_count: Number(exposure.rows[0]?.count || 0), missing_step_count: Number(missing.rows[0]?.count || 0), proof_state_anomaly_count: Number(steps.rows[0]?.proof_state_anomaly_count || 0) }
}
