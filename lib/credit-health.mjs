/** Aggregate integer-accounting evidence. Does not expose accounts or transaction hashes. */
export async function inspectCreditHealth(client) {
  const result = await client.execute(`SELECT
    (SELECT COALESCE(SUM(available_minor + escrow_minor), 0) FROM credit_accounts) AS liability_minor,
    (SELECT COALESCE(SUM(amount_minor), 0) FROM credit_deposits WHERE state = 'confirmed') AS deposits_minor,
    (SELECT COUNT(*) FROM credit_accounts a WHERE a.available_minor < 0 OR a.escrow_minor < 0
      OR a.available_minor != COALESCE((SELECT SUM(e.available_delta) FROM credit_entries e WHERE e.user_id = a.user_id), 0)
      OR a.escrow_minor != COALESCE((SELECT SUM(e.escrow_delta) FROM credit_entries e WHERE e.user_id = a.user_id), 0)) AS account_anomalies,
    (SELECT COUNT(*) FROM credit_entries e WHERE NOT EXISTS (SELECT 1 FROM credit_accounts a WHERE a.user_id = e.user_id)) AS missing_accounts,
    (SELECT COUNT(*) FROM credit_deposits d WHERE d.state = 'confirmed' AND
      (d.tx_hash IS NULL OR d.payer_signature IS NULL
      OR NOT EXISTS (SELECT 1 FROM payment_receipts p WHERE p.tx_hash = d.tx_hash AND p.external_id = d.id AND p.route = '/api/wallet/deposits' AND p.trade_id IS NULL AND p.payment_rail = 'evm' AND p.chain_id = d.chain_id AND p.payer_address = d.payer AND p.token_address = d.token AND p.token_decimals = 6 AND CAST(p.token_amount AS INTEGER) = d.amount_minor * 10000)
      OR NOT EXISTS (SELECT 1 FROM credit_entries e WHERE e.reference = d.id AND e.kind = 'deposit' AND e.user_id = d.user_id AND e.available_delta = d.amount_minor AND e.escrow_delta = 0))) AS deposit_anomalies,
    (SELECT COUNT(*) FROM credit_entries e WHERE e.kind = 'deposit' AND NOT EXISTS (SELECT 1 FROM credit_deposits d WHERE d.id = e.reference AND d.user_id = e.user_id AND d.state = 'confirmed' AND d.amount_minor = e.available_delta)) AS mint_anomalies`)
  const row = Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)]))
  return { liability_minor: row.liability_minor, deposits_minor: row.deposits_minor,
    account_anomalies: row.account_anomalies, missing_accounts: row.missing_accounts,
    deposit_anomalies: row.deposit_anomalies, mint_anomalies: row.mint_anomalies,
    healthy: row.liability_minor === row.deposits_minor && !row.account_anomalies && !row.missing_accounts && !row.deposit_anomalies && !row.mint_anomalies }
}
