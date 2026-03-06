ALTER TABLE `trades` ADD `item_price` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `trades` ADD `platform_fee` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `trades` ADD `total_cost` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `trades` ADD `seller_amount` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `trades` ADD `dev_amount` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `trades` ADD `dev_wallet` text;
--> statement-breakpoint
ALTER TABLE `trades` ADD `fee_tx_hash` text;
--> statement-breakpoint
ALTER TABLE `trades` ADD `payout_status` text DEFAULT 'pending' NOT NULL;
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
