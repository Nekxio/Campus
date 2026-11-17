ALTER TABLE `quiz_run` ADD `quiz_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `quiz_run` ADD `opening_fingerprint` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `quiz_run` ADD `shuffle_seed` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `quiz_run` ADD `grade_baselines` text DEFAULT '[]' NOT NULL;