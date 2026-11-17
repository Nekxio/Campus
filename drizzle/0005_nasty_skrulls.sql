CREATE TABLE `publication_receipt` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`context_id` text NOT NULL,
	`request_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_context`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_receipt_teacher_request_unique` ON `publication_receipt` (`teacher_id`,`request_id`);--> statement-breakpoint
ALTER TABLE `module_publication` ADD `source_context_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `module_publication` ADD `source_class_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `module_publication` ADD `revision` integer DEFAULT 1 NOT NULL;