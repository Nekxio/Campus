CREATE TABLE `auth_rate_limit` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`started_at` integer NOT NULL,
	CONSTRAINT "rate_limit_positive" CHECK("auth_rate_limit"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer,
	`aaguid` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `passkey_userId_idx` ON `passkey` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `passkey_credentialID_idx` ON `passkey` (`credential_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`role` text DEFAULT 'teacher' NOT NULL,
	CONSTRAINT "user_teacher_only" CHECK("user"."role" = 'teacher')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `assessment_deadline` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`module_id` text NOT NULL,
	`assessment_id` text NOT NULL,
	`due_at` integer NOT NULL,
	`submission_instructions` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`context_id`,`module_id`) REFERENCES `teaching_context`(`id`,`module_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assessment_id`,`module_id`) REFERENCES `assessment`(`id`,`module_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deadline_context_assessment_unique` ON `assessment_deadline` (`context_id`,`assessment_id`);--> statement-breakpoint
CREATE TABLE `assessment` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`purpose` text DEFAULT 'graded' NOT NULL,
	`rubric_revision` integer DEFAULT 1 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `module`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "assessment_kind_allowed" CHECK("assessment"."kind" IN ('quiz', 'project', 'oral', 'other')),
	CONSTRAINT "assessment_purpose_allowed" CHECK("assessment"."purpose" IN ('graded', 'formative')),
	CONSTRAINT "assessment_revision_positive" CHECK("assessment"."rubric_revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_id_module_unique` ON `assessment` (`id`,`module_id`);--> statement-breakpoint
CREATE TABLE `class` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`academic_year` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "class_revision_positive" CHECK("class"."revision" > 0),
	CONSTRAINT "class_academic_year" CHECK(length("class"."academic_year") = 9 AND "class"."academic_year" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]' AND CAST(substr("class"."academic_year", 6, 4) AS INTEGER) = CAST(substr("class"."academic_year", 1, 4) AS INTEGER) + 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_year_name_unique` ON `class` (`academic_year`,`name`);--> statement-breakpoint
CREATE TABLE `correction_proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`student_id` text NOT NULL,
	`payload` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_context`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `student`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "proposal_state_allowed" CHECK("correction_proposal"."state" IN ('pending', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `proposal_context_student_idx` ON `correction_proposal` (`context_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `correction` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`module_id` text NOT NULL,
	`student_id` text NOT NULL,
	`assessment_id` text NOT NULL,
	`status` text DEFAULT 'to_evaluate' NOT NULL,
	`submitted_at` integer,
	`submission_url` text,
	`lateness_decision` text DEFAULT 'automatic' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `student`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`context_id`,`module_id`) REFERENCES `teaching_context`(`id`,`module_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assessment_id`,`module_id`) REFERENCES `assessment`(`id`,`module_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "correction_status_allowed" CHECK("correction"."status" IN ('to_evaluate', 'graded', 'absent_unjustified', 'absent_justified')),
	CONSTRAINT "correction_lateness_allowed" CHECK("correction"."lateness_decision" IN ('automatic', 'exempt', 'refused')),
	CONSTRAINT "correction_revision_positive" CHECK("correction"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `correction_context_student_assessment_unique` ON `correction` (`context_id`,`student_id`,`assessment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `correction_id_assessment_unique` ON `correction` (`id`,`assessment_id`);--> statement-breakpoint
CREATE TABLE `lesson` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`title` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`recap` text DEFAULT '' NOT NULL,
	`to_do` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_context`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lesson_dates_ordered" CHECK("lesson"."ends_at" >= "lesson"."starts_at")
);
--> statement-breakpoint
CREATE INDEX `lesson_context_idx` ON `lesson` (`context_id`);--> statement-breakpoint
CREATE TABLE `module_publication` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`source_revision` integer NOT NULL,
	`published_at` integer NOT NULL,
	`unpublished_at` integer,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_context`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "publication_revision_positive" CHECK("module_publication"."source_revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `module_publication_context_id_unique` ON `module_publication` (`context_id`);--> statement-breakpoint
CREATE TABLE `module` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`preparation` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "module_revision_positive" CHECK("module"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE `module_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`kind` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `module`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "resource_kind_allowed" CHECK("module_resource"."kind" IN ('course', 'instructions', 'rubric', 'resource'))
);
--> statement-breakpoint
CREATE INDEX `resource_module_idx` ON `module_resource` (`module_id`);--> statement-breakpoint
CREATE TABLE `result_definition` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`title` text NOT NULL,
	`rule` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `module`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `result_module_idx` ON `result_definition` (`module_id`);--> statement-breakpoint
CREATE TABLE `rubric_group` (
	`id` text PRIMARY KEY NOT NULL,
	`assessment_id` text NOT NULL,
	`title` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`retired_at` integer,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessment`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rubric_group_id_assessment_unique` ON `rubric_group` (`id`,`assessment_id`);--> statement-breakpoint
CREATE TABLE `rubric_line` (
	`id` text PRIMARY KEY NOT NULL,
	`assessment_id` text NOT NULL,
	`group_id` text NOT NULL,
	`label` text NOT NULL,
	`max_points` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`retired_at` integer,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessment`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`group_id`,`assessment_id`) REFERENCES `rubric_group`(`id`,`assessment_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rubric_max_positive_integer" CHECK(typeof("rubric_line"."max_points") = 'integer' AND "rubric_line"."max_points" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rubric_line_id_assessment_unique` ON `rubric_line` (`id`,`assessment_id`);--> statement-breakpoint
CREATE TABLE `score` (
	`id` text PRIMARY KEY NOT NULL,
	`correction_id` text NOT NULL,
	`assessment_id` text NOT NULL,
	`line_id` text NOT NULL,
	`points` integer,
	FOREIGN KEY (`correction_id`,`assessment_id`) REFERENCES `correction`(`id`,`assessment_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`line_id`,`assessment_id`) REFERENCES `rubric_line`(`id`,`assessment_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "score_nonnegative_integer" CHECK("score"."points" IS NULL OR (typeof("score"."points") = 'integer' AND "score"."points" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `score_correction_line_unique` ON `score` (`correction_id`,`line_id`);--> statement-breakpoint
CREATE TABLE `semester_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`student_id` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_context`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `student`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "comment_revision_positive" CHECK("semester_comment"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comment_context_student_unique` ON `semester_comment` (`context_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `student` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `class`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "student_revision_positive" CHECK("student"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `student_class_idx` ON `student` (`class_id`);--> statement-breakpoint
CREATE TABLE `teaching_context` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`class_id` text,
	`class_name` text NOT NULL,
	`academic_year` text NOT NULL,
	`preparation` text NOT NULL,
	`archived_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `module`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`class_id`) REFERENCES `class`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "context_revision_positive" CHECK("teaching_context"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `context_module_class_unique` ON `teaching_context` (`module_id`,`class_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `context_id_module_unique` ON `teaching_context` (`id`,`module_id`);--> statement-breakpoint
CREATE INDEX `context_year_idx` ON `teaching_context` (`academic_year`);