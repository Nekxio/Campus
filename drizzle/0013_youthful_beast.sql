CREATE TABLE `quiz_draft_receipt` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`request_id` text NOT NULL,
	`quiz_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quiz_id`) REFERENCES `quiz_draft`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_draft_receipt_request` ON `quiz_draft_receipt` (`teacher_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `quiz_draft` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`context_id` text NOT NULL,
	`lesson_id` text,
	`assessment_id` text NOT NULL,
	`line_id` text NOT NULL,
	`content` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`needs_review` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `module`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`context_id`,`module_id`) REFERENCES `teaching_context`(`id`,`module_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assessment_id`,`module_id`) REFERENCES `assessment`(`id`,`module_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`line_id`,`assessment_id`) REFERENCES `rubric_line`(`id`,`assessment_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "quiz_draft_revision_positive" CHECK("quiz_draft"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_draft_scoring_line` ON `quiz_draft` (`context_id`,`line_id`);--> statement-breakpoint
CREATE INDEX `quiz_draft_module` ON `quiz_draft` (`module_id`);--> statement-breakpoint
CREATE TABLE `quiz_grade_receipt` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`request_id` text NOT NULL,
	`student_id` text NOT NULL,
	`context_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `student`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_context`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_grade_receipt_request` ON `quiz_grade_receipt` (`teacher_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `quiz_grade_report` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`run_id` text NOT NULL,
	`context_id` text NOT NULL,
	`student_id` text NOT NULL,
	`correction_id` text NOT NULL,
	`line_id` text NOT NULL,
	`points` integer NOT NULL,
	`source` text NOT NULL,
	`correction_revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quiz_draft`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_id`) REFERENCES `quiz_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_context`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `student`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`correction_id`) REFERENCES `correction`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`line_id`) REFERENCES `rubric_line`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "quiz_grade_report_points" CHECK(typeof("quiz_grade_report"."points") = 'integer' AND "quiz_grade_report"."points" >= 0),
	CONSTRAINT "quiz_grade_report_source" CHECK("quiz_grade_report"."source" IN ('attempt', 'absence', 'stopped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_grade_report_student_line` ON `quiz_grade_report` (`context_id`,`student_id`,`line_id`);--> statement-breakpoint
CREATE TABLE `quiz_run` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`context_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`source_run_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quiz_draft`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_context`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teacher_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_run_id`) REFERENCES `quiz_run`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quiz_run_status" CHECK("quiz_run"."status" IN ('lobby', 'running', 'closed'))
);
--> statement-breakpoint
CREATE INDEX `quiz_run_context_status` ON `quiz_run` (`context_id`,`status`);