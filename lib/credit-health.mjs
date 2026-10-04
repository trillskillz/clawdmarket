/** Aggregate integer-accounting evidence. Does not expose accounts or transaction hashes. */
export async function inspectCreditHealth(client) {
  const result = await client.execute(`SELECT
    ((SELECT COALESCE(SUM(available_minor + escrow_minor), 0) FROM credit_accounts) + (SELECT COALESCE(SUM(balance_minor), 0) FROM instant_sessions)) AS liability_minor,
    (SELECT COALESCE(SUM(amount_minor), 0) FROM credit_deposits WHERE state = 'confirmed') AS deposits_minor,
    (SELECT COUNT(*) FROM credit_accounts a WHERE a.available_minor < 0 OR a.escrow_minor < 0
      OR a.available_minor != COALESCE((SELECT SUM(e.available_delta) FROM credit_entries e WHERE e.user_id = a.user_id), 0)
      OR a.escrow_minor != COALESCE((SELECT SUM(e.escrow_delta) FROM credit_entries e WHERE e.user_id = a.user_id), 0)) AS account_anomalies,
    (SELECT COUNT(*) FROM credit_entries e WHERE NOT EXISTS (SELECT 1 FROM credit_accounts a WHERE a.user_id = e.user_id)) AS missing_accounts,
    (SELECT COUNT(*) FROM credit_deposits d WHERE d.state = 'confirmed' AND
      (d.tx_hash IS NULL OR d.payer_signature IS NULL
      OR NOT EXISTS (SELECT 1 FROM payment_receipts p WHERE p.tx_hash = d.tx_hash AND p.external_id = d.id AND p.route = '/api/wallet/deposits' AND p.trade_id IS NULL AND p.payment_rail = 'evm' AND p.chain_id = d.chain_id AND p.payer_address = d.payer AND p.token_address = d.token AND p.token_decimals = 6 AND CAST(p.token_amount AS INTEGER) = d.amount_minor * 10000)
      OR NOT EXISTS (SELECT 1 FROM credit_entries e WHERE e.reference = d.id AND e.kind = 'deposit' AND e.user_id = d.user_id AND e.available_delta = d.amount_minor AND e.escrow_delta = 0))) AS deposit_anomalies,
    (SELECT COUNT(*) FROM credit_entries e WHERE e.kind = 'deposit' AND NOT EXISTS (SELECT 1 FROM credit_deposits d WHERE d.id = e.reference AND d.user_id = e.user_id AND d.state = 'confirmed' AND d.amount_minor = e.available_delta)) AS mint_anomalies,
    (SELECT COUNT(*) FROM instant_sessions s WHERE
      s.balance_minor < 0 OR s.held_minor < 0 OR s.held_minor > s.balance_minor OR s.spent_minor < 0 OR s.refunded_minor < 0
      OR s.budget_minor != s.balance_minor + s.spent_minor + s.refunded_minor
      OR s.held_minor != COALESCE((SELECT SUM(c.unit_price_minor) FROM instant_calls c WHERE c.session_id = s.id AND c.state IN ('pending','claimed')), 0)
      OR s.spent_minor != COALESCE((SELECT SUM(c.unit_price_minor) FROM instant_calls c WHERE c.session_id = s.id AND c.state = 'completed'), 0)
      OR NOT EXISTS (SELECT 1 FROM credit_entries e WHERE e.reference = s.id AND e.user_id = s.buyer_id AND e.kind = 'instant_funding' AND e.available_delta = -s.budget_minor AND e.escrow_delta = 0)
      OR (s.refunded_minor > 0 AND NOT EXISTS (SELECT 1 FROM credit_entries e WHERE e.reference = s.id AND e.user_id = s.buyer_id AND e.kind = 'instant_refund' AND e.available_delta = s.refunded_minor AND e.escrow_delta = 0))
      OR (s.status = 'closed' AND (s.balance_minor != 0 OR s.held_minor != 0 OR s.closed_at IS NULL))) AS instant_session_anomalies,
    (SELECT COUNT(*) FROM instant_calls c JOIN instant_sessions s ON s.id = c.session_id WHERE
      (c.state = 'completed' AND (c.receipt_json IS NULL OR c.output_json IS NULL OR NOT json_valid(c.receipt_json)
        OR CASE WHEN json_valid(c.receipt_json) THEN
          json_extract(c.receipt_json, '$.call_id') IS NOT c.id OR json_extract(c.receipt_json, '$.session_id') IS NOT s.id
          OR json_extract(c.receipt_json, '$.seller_id') IS NOT c.seller_id OR json_extract(c.receipt_json, '$.buyer_id') IS NOT s.buyer_id
          OR json_extract(c.receipt_json, '$.amount_minor') IS NOT c.unit_price_minor OR json_extract(c.receipt_json, '$.units') IS NOT 1
          OR json_extract(c.receipt_json, '$.payment_rail') IS NOT 'credit' ELSE 1 END
        OR NOT EXISTS (SELECT 1 FROM credit_entries e WHERE e.reference = c.id AND e.kind = 'instant_sale' AND e.user_id = c.seller_id AND e.available_delta = c.unit_price_minor AND e.escrow_delta = 0)))
      OR (c.state != 'completed' AND (c.receipt_json IS NOT NULL OR EXISTS (SELECT 1 FROM credit_entries e WHERE e.reference = c.id AND e.kind = 'instant_sale')))) AS instant_call_anomalies,
    (SELECT COUNT(*) FROM credit_entries e WHERE
      (e.kind = 'instant_funding' AND NOT EXISTS (SELECT 1 FROM instant_sessions s WHERE s.id = e.reference AND s.buyer_id = e.user_id AND e.available_delta = -s.budget_minor AND e.escrow_delta = 0))
      OR (e.kind = 'instant_refund' AND NOT EXISTS (SELECT 1 FROM instant_sessions s WHERE s.id = e.reference AND s.buyer_id = e.user_id AND e.available_delta = s.refunded_minor AND e.escrow_delta = 0))
      OR (e.kind = 'instant_sale' AND NOT EXISTS (SELECT 1 FROM instant_calls c WHERE c.id = e.reference AND c.seller_id = e.user_id AND c.state = 'completed' AND e.available_delta = c.unit_price_minor AND e.escrow_delta = 0))) AS instant_entry_anomalies`)
  const row = Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)]))
  return { liability_minor: row.liability_minor, deposits_minor: row.deposits_minor,
    account_anomalies: row.account_anomalies, missing_accounts: row.missing_accounts,
    deposit_anomalies: row.deposit_anomalies, mint_anomalies: row.mint_anomalies,
    instant_session_anomalies: row.instant_session_anomalies, instant_call_anomalies: row.instant_call_anomalies, instant_entry_anomalies: row.instant_entry_anomalies,
    healthy: row.liability_minor === row.deposits_minor && !row.account_anomalies && !row.missing_accounts && !row.deposit_anomalies && !row.mint_anomalies && !row.instant_session_anomalies && !row.instant_call_anomalies && !row.instant_entry_anomalies }
}
