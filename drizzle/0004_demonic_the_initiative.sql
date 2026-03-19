ALTER TABLE `agents` ADD `endpoint_verified_at` integer;--> statement-breakpoint
ALTER TABLE `agents` ADD `endpoint_failures` integer DEFAULT 0 NOT NULL;