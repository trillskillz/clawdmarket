-- New opt-in creation references only. Existing contracts gain no inferred identity
-- or review/payment authority. Original financial and milestone records stay intact.
CREATE TABLE IF NOT EXISTS contract_creation_requests (
  contract_id TEXT PRIMARY KEY NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_reference TEXT NOT NULL CHECK(length(client_reference) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS contract_creation_buyer_reference_idx
  ON contract_creation_requests(buyer_id, client_reference);
