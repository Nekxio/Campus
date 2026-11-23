import { sql } from 'drizzle-orm';
import {
	check,
	foreignKey,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
	type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core';
import { user } from './auth.schema.js';
import {
	modules,
	teachingContexts,
	lessons,
	assessments,
	rubricLines,
	corrections,
	students
} from './teaching.schema.js';
import type { QuizArchiveReceipt, QuizContent, QuizDraftReceipt, QuizGradeReceipt } from '../../domain/quiz-content.js';

const createdAt = () =>
	integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date());

export const quizDrafts = sqliteTable(
	'quiz_draft',
	{
		id: text('id').primaryKey(),
		moduleId: text('module_id')
			.notNull()
			.references(() => modules.id, { onDelete: 'restrict' }),
		contextId: text('context_id').notNull(),
		lessonId: text('lesson_id').references(() => lessons.id, { onDelete: 'set null' }),
		assessmentId: text('assessment_id').notNull(),
		lineId: text('line_id').notNull(),
		content: text('content', { mode: 'json' }).$type<QuizContent>().notNull(),
		revision: integer('revision').notNull().default(1),
		needsReview: integer('needs_review', { mode: 'boolean' }).notNull().default(false),
		archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
		createdAt: createdAt()
	},
	(table) => [
		foreignKey({
			columns: [table.contextId, table.moduleId],
			foreignColumns: [teachingContexts.id, teachingContexts.moduleId]
		}).onDelete('restrict'),
		foreignKey({
			columns: [table.assessmentId, table.moduleId],
			foreignColumns: [assessments.id, assessments.moduleId]
		}).onDelete('restrict'),
		foreignKey({
			columns: [table.lineId, table.assessmentId],
			foreignColumns: [rubricLines.id, rubricLines.assessmentId]
		}).onDelete('restrict'),
		uniqueIndex('quiz_draft_scoring_line').on(table.contextId, table.lineId),
		index('quiz_draft_module').on(table.moduleId),
		check('quiz_draft_revision_positive', sql`${table.revision} > 0`)
	]
);

export const quizDraftReceipts = sqliteTable(
	'quiz_draft_receipt',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		teacherId: text('teacher_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		requestId: text('request_id').notNull(),
		quizId: text('quiz_id')
			.notNull()
			.references(() => quizDrafts.id, { onDelete: 'restrict' }),
		fingerprint: text('fingerprint').notNull(),
		receipt: text('receipt', { mode: 'json' }).$type<QuizDraftReceipt | QuizArchiveReceipt>().notNull(),
		createdAt: createdAt()
	},
	(table) => [uniqueIndex('quiz_draft_receipt_request').on(table.teacherId, table.requestId)]
);

export const quizRuns = sqliteTable(
	'quiz_run',
	{
		id: text('id').primaryKey(),
		quizId: text('quiz_id')
			.notNull()
			.references(() => quizDrafts.id, { onDelete: 'restrict' }),
		contextId: text('context_id')
			.notNull()
			.references(() => teachingContexts.id, { onDelete: 'cascade' }),
		teacherId: text('teacher_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		status: text('status', { enum: ['lobby', 'running', 'closed'] })
			.notNull()
			.default('lobby'),
		quizRevision: integer('quiz_revision').notNull().default(1),
		openingFingerprint: text('opening_fingerprint').notNull().default(''),
		shuffleSeed: text('shuffle_seed').notNull().default(''),
		gradeBaselines: text('grade_baselines', { mode: 'json' })
			.$type<{ studentId: string; name: string; correctionRevision: number; requestId: string }[]>()
			.notNull()
			.default(sql`'[]'`),
		sourceRunId: text('source_run_id').references((): AnySQLiteColumn => quizRuns.id, {
			onDelete: 'cascade'
		}),
		createdAt: createdAt()
	},
	(table) => [
		index('quiz_run_context_status').on(table.contextId, table.status),
		check('quiz_run_status', sql`${table.status} IN ('lobby', 'running', 'closed')`)
	]
);

export const quizGradeReports = sqliteTable(
	'quiz_grade_report',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		quizId: text('quiz_id')
			.notNull()
			.references(() => quizDrafts.id, { onDelete: 'restrict' }),
		runId: text('run_id')
			.notNull()
			.references(() => quizRuns.id, { onDelete: 'cascade' }),
		contextId: text('context_id')
			.notNull()
			.references(() => teachingContexts.id, { onDelete: 'cascade' }),
		studentId: text('student_id')
			.notNull()
			.references(() => students.id, { onDelete: 'cascade' }),
		correctionId: text('correction_id')
			.notNull()
			.references(() => corrections.id, { onDelete: 'cascade' }),
		lineId: text('line_id')
			.notNull()
			.references(() => rubricLines.id, { onDelete: 'restrict' }),
		points: integer('points').notNull(),
		source: text('source', { enum: ['attempt', 'absence', 'stopped'] }).notNull(),
		correctionRevision: integer('correction_revision').notNull(),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('quiz_grade_report_student_line').on(table.contextId, table.studentId, table.lineId),
		check('quiz_grade_report_points', sql`typeof(${table.points}) = 'integer' AND ${table.points} >= 0`),
		check('quiz_grade_report_source', sql`${table.source} IN ('attempt', 'absence', 'stopped')`)
	]
);

export const quizGradeReceipts = sqliteTable(
	'quiz_grade_receipt',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		teacherId: text('teacher_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		requestId: text('request_id').notNull(),
		studentId: text('student_id')
			.notNull()
			.references(() => students.id, { onDelete: 'cascade' }),
		contextId: text('context_id')
			.notNull()
			.references(() => teachingContexts.id, { onDelete: 'cascade' }),
		fingerprint: text('fingerprint').notNull(),
		receipt: text('receipt', { mode: 'json' }).$type<QuizGradeReceipt>().notNull(),
		createdAt: createdAt()
	},
	(table) => [uniqueIndex('quiz_grade_receipt_request').on(table.teacherId, table.requestId)]
);
