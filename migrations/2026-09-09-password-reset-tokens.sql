CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE cascade,
  expires_at integer NOT NULL,
  created_at integer NOT NULL
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx
  ON password_reset_tokens(expires_at);
