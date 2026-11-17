ALTER TABLE `assessment` ADD `retired_at` integer;--> statement-breakpoint
ALTER TABLE `rubric_line` ADD `description` text DEFAULT '' NOT NULL;