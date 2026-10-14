CREATE TABLE `apikey` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text DEFAULT 'coursely-module-drafts' NOT NULL,
	`name` text,
	`start` text,
	`prefix` text,
	`key` text NOT NULL,
	`reference_id` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer DEFAULT true,
	`rate_limit_enabled` integer DEFAULT true,
	`rate_limit_time_window` integer DEFAULT 60000,
	`rate_limit_max` integer DEFAULT 60,
	`request_count` integer DEFAULT 0,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`permissions` text,
	`metadata` text,
	FOREIGN KEY (`reference_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apikey_key_unique` ON `apikey` (`key`);--> statement-breakpoint
CREATE INDEX `apikey_reference_idx` ON `apikey` (`reference_id`);--> statement-breakpoint
CREATE INDEX `apikey_config_idx` ON `apikey` (`config_id`);--> statement-breakpoint
CREATE TABLE `agent_import` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`request_id` text NOT NULL,
	`module_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`) REFERENCES `module`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_import_teacher_request_unique` ON `agent_import` (`teacher_id`,`request_id`);