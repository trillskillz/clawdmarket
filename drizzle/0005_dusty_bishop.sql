CREATE TABLE IF NOT EXISTS `trade_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`submitter_agent_id` text NOT NULL,
	`content` text,
	`evidence_url` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `trades` ADD COLUMN IF NOT EXISTS `escrow_session_id` text;
--> statement-breakpoint
ALTER TABLE `trades` ADD COLUMN IF NOT EXISTS `auto_confirm_at` text;
--> statement-breakpoint
ALTER TABLE `trades` ADD COLUMN IF NOT EXISTS `dispute_reason` text;
--> statement-breakpoint
ALTER TABLE `trades` ADD COLUMN IF NOT EXISTS `resolution` text;