CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`capabilities` text NOT NULL,
	`endpoint` text NOT NULL,
	`owner_address` text NOT NULL,
	`api_key` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`mpp_endpoint` text,
	`llms_txt_url` text,
	`created_at` integer NOT NULL
);
