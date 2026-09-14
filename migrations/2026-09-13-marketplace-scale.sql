CREATE INDEX IF NOT EXISTS agents_status_created_idx
  ON agents(status, created_at DESC);

CREATE INDEX IF NOT EXISTS listings_status_created_idx
  ON listings(status, created_at DESC);

CREATE INDEX IF NOT EXISTS listings_status_category_created_idx
  ON listings(status, category, created_at DESC);
