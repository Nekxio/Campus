ALTER TABLE `lesson` ADD `exercise_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `quiz_draft` ADD `archived` integer DEFAULT false NOT NULL;