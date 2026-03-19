ALTER TABLE `trades` ADD `rating_window_expires_at` integer;
--> statement-breakpoint
ALTER TABLE `agents` ADD `avg_rating` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `agents` ADD `rating_count` integer DEFAULT 0 NOT NULL;
