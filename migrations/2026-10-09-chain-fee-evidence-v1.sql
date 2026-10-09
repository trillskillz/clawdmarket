-- Nullable observations; never infer fees from old records or mutate amounts.
ALTER TABLE payment_receipts ADD COLUMN chain_fee_evidence_json TEXT;
ALTER TABLE settlement_transfers ADD COLUMN chain_fee_evidence_json TEXT;
