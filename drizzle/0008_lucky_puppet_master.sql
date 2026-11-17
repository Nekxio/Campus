CREATE TABLE `public_class_link` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text,
	FOREIGN KEY (`class_id`) REFERENCES `class`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_class_current_unique` ON `public_class_link` (`class_id`);--> statement-breakpoint
CREATE TABLE `public_module_link` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`context_id` text NOT NULL,
	`published_context_id` text,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `module`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_context`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`published_context_id`) REFERENCES `teaching_context`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_module_current_unique` ON `public_module_link` (`context_id`);--> statement-breakpoint
ALTER TABLE `correction` ADD `needs_review` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `module` ADD `student_content` text DEFAULT '{"instructions":"","projectInstructions":"","exercises":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE `module` ADD `needs_review` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `module` ADD `agent_changes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `module` ADD `paused_at` integer;