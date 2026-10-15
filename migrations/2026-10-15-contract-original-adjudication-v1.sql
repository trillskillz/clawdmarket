-- Preserve new reviewed original admin outcomes; no legacy inference or buyer consent.
CREATE TABLE IF NOT EXISTS contract_adjudication_operations (
  dispute_id TEXT PRIMARY KEY NOT NULL REFERENCES contract_disputes(id) ON DELETE RESTRICT,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  milestone_id TEXT NOT NULL REFERENCES contract_milestones(id) ON DELETE RESTRICT,
  authorization_id TEXT NOT NULL REFERENCES organization_contract_uses(authorization_id) ON DELETE RESTRICT,
  authority_hash TEXT NOT NULL,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_by_account_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ruling TEXT NOT NULL, split_percent_to_seller REAL,
  amount_minor INTEGER NOT NULL, buyer_refund_minor INTEGER NOT NULL, seller_credit_minor INTEGER NOT NULL,
  settlement_entry_id TEXT REFERENCES credit_entries(id) ON DELETE RESTRICT,
  sale_entry_id TEXT REFERENCES credit_entries(id) ON DELETE RESTRICT,
  decision_hash TEXT NOT NULL, resolved_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS reviewed_contract_adjudication_immutable_update
  BEFORE UPDATE ON contract_adjudication_operations BEGIN SELECT RAISE(ABORT, 'reviewed_contract_adjudication_immutable'); END;
CREATE TRIGGER IF NOT EXISTS reviewed_contract_adjudication_immutable_delete
  BEFORE DELETE ON contract_adjudication_operations BEGIN SELECT RAISE(ABORT, 'reviewed_contract_adjudication_immutable'); END;
CREATE TRIGGER IF NOT EXISTS reviewed_contract_dispute_immutable_update
  BEFORE UPDATE ON contract_disputes WHEN EXISTS (SELECT 1 FROM contract_adjudication_operations o WHERE o.dispute_id=OLD.id)
  BEGIN SELECT RAISE(ABORT, 'reviewed_contract_dispute_immutable'); END;
CREATE TRIGGER IF NOT EXISTS reviewed_contract_dispute_immutable_delete
  BEFORE DELETE ON contract_disputes WHEN EXISTS (SELECT 1 FROM contract_adjudication_operations o WHERE o.dispute_id=OLD.id)
  BEGIN SELECT RAISE(ABORT, 'reviewed_contract_dispute_immutable'); END;
