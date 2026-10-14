CREATE TABLE `academic_year_lifecycle` (
	`academic_year` text PRIMARY KEY NOT NULL,
	`archived_at` integer,
	`purged_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "year_revision_positive" CHECK("academic_year_lifecycle"."revision" > 0),
	CONSTRAINT "purged_year_archived" CHECK("academic_year_lifecycle"."purged_at" IS NULL OR "academic_year_lifecycle"."archived_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `annual_receipt` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`request_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `annual_teacher_request_unique` ON `annual_receipt` (`teacher_id`,`request_id`);