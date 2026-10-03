CREATE TABLE IF NOT EXISTS credit_accounts (
        user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        available_minor INTEGER NOT NULL DEFAULT 0, escrow_minor INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT credit_accounts_nonnegative CHECK(available_minor >= 0 AND escrow_minor >= 0));

CREATE TABLE IF NOT EXISTS credit_entries (
        id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        reference TEXT NOT NULL, kind TEXT NOT NULL, available_delta INTEGER NOT NULL, escrow_delta INTEGER NOT NULL, created_at INTEGER NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS credit_entries_reference_idx ON credit_entries(user_id, reference, kind);

CREATE TABLE IF NOT EXISTS credit_deposits (
        id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        client_reference TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
        payer TEXT NOT NULL, treasury TEXT NOT NULL, token TEXT NOT NULL, chain_id INTEGER NOT NULL,
        tx_hash TEXT, payer_signature TEXT, state TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS credit_deposits_reference_idx ON credit_deposits(user_id, client_reference);

CREATE UNIQUE INDEX IF NOT EXISTS credit_deposits_hash_idx ON credit_deposits(tx_hash);
