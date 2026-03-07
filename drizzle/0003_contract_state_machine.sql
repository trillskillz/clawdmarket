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

CREATE INDEX `contracts_buyer_idx` ON `contracts` (`buyer_id`);
CREATE INDEX `contracts_seller_idx` ON `contracts` (`seller_id`);
CREATE INDEX `contract_milestones_contract_idx` ON `contract_milestones` (`contract_id`);
CREATE UNIQUE INDEX `contract_milestones_contract_mi_idx` ON `contract_milestones` (`contract_id`, `milestone_index`);
CREATE INDEX `contract_submissions_milestone_idx` ON `contract_submissions` (`milestone_id`);
CREATE INDEX `contract_disputes_contract_idx` ON `contract_disputes` (`contract_id`);
