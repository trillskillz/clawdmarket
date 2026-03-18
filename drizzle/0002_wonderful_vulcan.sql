CREATE TABLE `contract_disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`milestone_id` text,
	`raised_by` text NOT NULL,
	`reason_code` text NOT NULL,
	`evidence` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`ruling` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`milestone_id`) REFERENCES `contract_milestones`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`raised_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contract_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`milestone_index` integer NOT NULL,
	`title` text NOT NULL,
	`amount` real NOT NULL,
	`acceptance_spec` text NOT NULL,
	`deadline_at` integer,
	`review_window_hours` integer DEFAULT 24 NOT NULL,
	`state` text DEFAULT 'PENDING' NOT NULL,
	`submission_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contract_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`milestone_id` text NOT NULL,
	`submitted_by` text NOT NULL,
	`artifact_bundle` text NOT NULL,
	`auto_check_result` text DEFAULT 'inconclusive' NOT NULL,
	`auto_check_report` text NOT NULL,
	`submitted_at` integer NOT NULL,
	FOREIGN KEY (`milestone_id`) REFERENCES `contract_milestones`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`buyer_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`listing_id` text,
	`total_amount` real NOT NULL,
	`fee_amount` real DEFAULT 0 NOT NULL,
	`escrow_amount` real DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'DRAFT' NOT NULL,
	`expires_at` integer,
	`current_milestone_index` integer DEFAULT 0 NOT NULL,
	`dispute_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`buyer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `fee_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text,
	`listing_id` text,
	`buyer_id` text,
	`item_price` real NOT NULL,
	`expected_dev_fee` real NOT NULL,
	`actual_dev_fee` real NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mpp_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`payer_address` text,
	`reserved_amount` real DEFAULT 0 NOT NULL,
	`spent_amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`closed_at` integer
);
--> statement-breakpoint
CREATE TABLE `payment_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`route` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`tx_hash` text,
	`payer_address` text,
	`token_address` text,
	`chain_id` integer,
	`token_symbol` text,
	`token_amount` text,
	`usd_value_at_payment` real,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `trades` ADD `item_price` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` ADD `platform_fee` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` ADD `total_cost` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` ADD `seller_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` ADD `dev_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` ADD `dev_wallet` text;--> statement-breakpoint
ALTER TABLE `trades` ADD `fee_tx_hash` text;--> statement-breakpoint
ALTER TABLE `trades` ADD `payout_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `is_banned` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `users` ADD `updated_at` integer;