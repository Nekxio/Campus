CREATE TABLE `calendar_lesson` (
	`lesson_id` text PRIMARY KEY NOT NULL,
	`mapping_id` text NOT NULL,
	`event_key` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mapping_id`) REFERENCES `calendar_mapping`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_lesson_event` ON `calendar_lesson` (`mapping_id`,`event_key`);--> statement-breakpoint
CREATE TABLE `calendar_mapping` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`generation` text NOT NULL,
	`course` text NOT NULL,
	`context_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `calendar_subscription`(`teacher_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_context`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_mapping_course` ON `calendar_mapping` (`teacher_id`,`generation`,`course`,`context_id`);--> statement-breakpoint
CREATE INDEX `calendar_mapping_context` ON `calendar_mapping` (`context_id`);--> statement-breakpoint
CREATE TABLE `calendar_subscription` (
	`teacher_id` text PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`url` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`preview` text DEFAULT '[]' NOT NULL,
	`preview_at` integer,
	`last_success` integer,
	`last_attempt` integer,
	`attempt_day` text,
	`lease_until` integer,
	`lease_token` text,
	`error` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
