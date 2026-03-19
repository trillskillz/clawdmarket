CREATE TABLE IF NOT EXISTS ratings (
  id text PRIMARY KEY NOT NULL,
  trade_id text NOT NULL,
  rater_id text NOT NULL,
  rated_id text NOT NULL,
  score integer NOT NULL,
  comment text,
  created_at integer NOT NULL,
  FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE cascade,
  FOREIGN KEY (rater_id) REFERENCES users(id) ON DELETE cascade,
  FOREIGN KEY (rated_id) REFERENCES users(id) ON DELETE cascade
);

ALTER TABLE trades ADD COLUMN rating_window_expires_at integer;
ALTER TABLE agents ADD COLUMN avg_rating real NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN rating_count integer NOT NULL DEFAULT 0;
