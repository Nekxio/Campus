CREATE TABLE `proposal_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`request_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `correction_proposal`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposal_decision_request_unique` ON `proposal_decision` (`proposal_id`,`request_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_correction_proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`student_id` text NOT NULL,
	`payload` text NOT NULL,
	`teacher_id` text,
	`request_id` text,
	`fingerprint` text,
	`receipt` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`comment_state` text DEFAULT 'none' NOT NULL,
	`applied_correction_revision` integer,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_context`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `student`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teacher_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "proposal_revision_positive" CHECK("__new_correction_proposal"."revision" > 0),
	CONSTRAINT "proposal_comment_state_allowed" CHECK("__new_correction_proposal"."comment_state" IN ('none', 'pending', 'accepted', 'kept')),
	CONSTRAINT "proposal_state_allowed" CHECK("__new_correction_proposal"."state" IN ('pending', 'accepted', 'rejected'))
);
--> statement-breakpoint
INSERT INTO `__new_correction_proposal`("id", "context_id", "student_id", "payload", "state", "created_at") SELECT "id", "context_id", "student_id", "payload", "state", "created_at" FROM `correction_proposal`;--> statement-breakpoint
DROP TABLE `correction_proposal`;--> statement-breakpoint
ALTER TABLE `__new_correction_proposal` RENAME TO `correction_proposal`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `proposal_context_student_idx` ON `correction_proposal` (`context_id`,`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `proposal_teacher_request_unique` ON `correction_proposal` (`teacher_id`,`request_id`);