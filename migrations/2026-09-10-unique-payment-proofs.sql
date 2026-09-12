-- A settled transaction or MPP proof may fund at most one marketplace action.
-- Resolve historical duplicates deterministically before adding the constraint.
DELETE FROM payment_receipts
WHERE tx_hash IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid) FROM payment_receipts WHERE tx_hash IS NOT NULL GROUP BY tx_hash
  );

CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_tx_hash_unique
  ON payment_receipts (tx_hash);
