CREATE TABLE IF NOT EXISTS `rate_limits` (
  `key` text PRIMARY KEY NOT NULL,
  `count` integer NOT NULL DEFAULT 0,
  `reset_at` integer NOT NULL
);
