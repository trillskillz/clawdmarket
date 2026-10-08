-- Runtime migration uses ensureColumns so fresh and upgraded databases can replay.
-- Existing funded contracts retain their historical wallet settlement rail.
ALTER TABLE contracts ADD COLUMN payment_rail TEXT NOT NULL DEFAULT 'ledger';
ALTER TABLE contracts ADD COLUMN funded_at INTEGER;
ALTER TABLE contracts ADD COLUMN organization_id TEXT;
