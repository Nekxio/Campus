import type { PublicationSnapshot, PublicationReceipt } from '../../domain/publication.js';
import type {
	AgentProposalPayload,
	ProposalReceipt,
	ProposalDecisionReceipt
} from '../../domain/proposals.js';
import { user } from './auth.schema.js';
import type { ImportReceipt } from '../../domain/module-import.js';
import { sql } from 'drizzle-orm';
import {
	sqliteTable,
	text,
	integer,
	index,
	uniqueIndex,
	check,
	foreignKey
} from 'drizzle-orm/sqlite-core';
import type {
	Preparation,
	Resource,
	ResultRule,
	CorrectionProposal,
	ModulePublication,
	AssessmentStatus
} from '../../domain/contracts.js';

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });
const createdAt = () =>
	timestamp('created_at')
		.notNull()
		.$defaultFn(() => new Date());
const revision = () => integer('revision').notNull().default(1);

export const modules = sqliteTable(
	'module',
	{
		id: id(),
		title: text('title').notNull(),
		description: text('description').notNull().default(''),
		objectives: text('objectives', { mode: 'json' }).$type<string[]>().notNull().default([]),
		sourcePath: text('source_path').notNull().default(''),
		studentContent: text('student_content', { mode: 'json' })
			.$type<import('../../domain/pedagogy.js').StudentContent>()
			.notNull()
			.default({ instructions: '', projectInstructions: '', exercises: [] }),
		needsReview: integer('needs_review', { mode: 'boolean' }).notNull().default(false),
		agentChanges: text('agent_changes', { mode: 'json' }).$type<string[]>().notNull().default([]),
		pausedAt: timestamp('paused_at'),
		preparation: text('preparation', { mode: 'json' })
			.$type<Preparation>()
			.notNull()
			.$defaultFn(() => ({ framing: '', nextSteps: '', sourceLinks: [] })),
		revision: revision(),
		createdAt: createdAt()
	},
	(table) => [check('module_revision_positive', sql`${table.revision} > 0`)]
);

export const classes = sqliteTable(
	'class',
	{
		id: id(),
		name: text('name').notNull(),
		academicYear: text('academic_year').notNull(),
		revision: revision(),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('class_year_name_unique').on(table.academicYear, table.name),
		check('class_revision_positive', sql`${table.revision} > 0`),
		check(
			'class_academic_year',
			sql`length(${table.academicYear}) = 9 AND ${table.academicYear} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]' AND CAST(substr(${table.academicYear}, 6, 4) AS INTEGER) = CAST(substr(${table.academicYear}, 1, 4) AS INTEGER) + 1`
		)
	]
);

export const students = sqliteTable(
	'student',
	{
		id: id(),
		classId: text('class_id')
			.notNull()
			.references(() => classes.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		position: integer('position').notNull().default(0),
		revision: revision()
	},
	(table) => [
		index('student_class_idx').on(table.classId),
		check('student_revision_positive', sql`${table.revision} > 0`)
	]
);

// An annual purge detaches the class and retains non-student preparation and calendar history.
export const teachingContexts = sqliteTable(
	'teaching_context',
	{
		id: id(),
		moduleId: text('module_id')
			.notNull()
			.references(() => modules.id, { onDelete: 'restrict' }),
		classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
		className: text('class_name').notNull(),
		academicYear: text('academic_year').notNull(),
		preparation: text('preparation', { mode: 'json' })
			.$type<Preparation>()
			.notNull()
			.$defaultFn(() => ({ framing: '', nextSteps: '', sourceLinks: [] })),
		archivedAt: timestamp('archived_at'),
		revision: revision(),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('context_module_class_unique').on(table.moduleId, table.classId),
		uniqueIndex('context_id_module_unique').on(table.id, table.moduleId),
		index('context_year_idx').on(table.academicYear),
		check('context_revision_positive', sql`${table.revision} > 0`)
	]
);

export const lessons = sqliteTable(
	'lesson',
	{
		id: id(),
		contextId: text('context_id')
			.notNull()
			.references(() => teachingContexts.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		startsAt: timestamp('starts_at').notNull(),
		endsAt: timestamp('ends_at').notNull(),
		recap: text('recap').notNull().default(''),
		toDo: text('to_do').notNull().default('')
	},
	(table) => [
		index('lesson_context_idx').on(table.contextId),
		check('lesson_dates_ordered', sql`${table.endsAt} >= ${table.startsAt}`)
	]
);

export const resources = sqliteTable(
	'module_resource',
	{
		id: id(),
		moduleId: text('module_id')
			.notNull()
			.references(() => modules.id, { onDelete: 'restrict' }),
		label: text('label').notNull(),
		url: text('url').notNull(),
		kind: text('kind', { enum: ['course', 'instructions', 'rubric', 'resource'] })
			.$type<Resource['kind']>()
			.notNull(),
		position: integer('position').notNull().default(0)
	},
	(table) => [
		index('resource_module_idx').on(table.moduleId),
		check(
			'resource_kind_allowed',
			sql`${table.kind} IN ('course', 'instructions', 'rubric', 'resource')`
		)
	]
);

export const assessments = sqliteTable(
	'assessment',
	{
		id: id(),
		moduleId: text('module_id')
			.notNull()
			.references(() => modules.id, { onDelete: 'restrict' }),
		title: text('title').notNull(),
		kind: text('kind', { enum: ['quiz', 'project', 'oral', 'other'] }).notNull(),
		purpose: text('purpose', { enum: ['graded', 'formative'] })
			.notNull()
			.default('graded'),
		rubricRevision: integer('rubric_revision').notNull().default(1),
		retiredAt: timestamp('retired_at'),
		position: integer('position').notNull().default(0)
	},
	(table) => [
		uniqueIndex('assessment_id_module_unique').on(table.id, table.moduleId),
		check('assessment_kind_allowed', sql`${table.kind} IN ('quiz', 'project', 'oral', 'other')`),
		check('assessment_purpose_allowed', sql`${table.purpose} IN ('graded', 'formative')`),
		check('assessment_revision_positive', sql`${table.rubricRevision} > 0`)
	]
);

export const rubricGroups = sqliteTable(
	'rubric_group',
	{
		id: id(),
		assessmentId: text('assessment_id')
			.notNull()
			.references(() => assessments.id, { onDelete: 'restrict' }),
		title: text('title').notNull(),
		position: integer('position').notNull().default(0),
		retiredAt: timestamp('retired_at')
	},
	(table) => [uniqueIndex('rubric_group_id_assessment_unique').on(table.id, table.assessmentId)]
);

export const rubricLines = sqliteTable(
	'rubric_line',
	{
		id: id(),
		assessmentId: text('assessment_id')
			.notNull()
			.references(() => assessments.id, { onDelete: 'restrict' }),
		groupId: text('group_id').notNull(),
		label: text('label').notNull(),
		description: text('description').notNull().default(''),
		maxPoints: integer('max_points').notNull(),
		position: integer('position').notNull().default(0),
		retiredAt: timestamp('retired_at')
	},
	(table) => [
		uniqueIndex('rubric_line_id_assessment_unique').on(table.id, table.assessmentId),
		foreignKey({
			columns: [table.groupId, table.assessmentId],
			foreignColumns: [rubricGroups.id, rubricGroups.assessmentId]
		}).onDelete('restrict'),
		check(
			'rubric_max_positive_integer',
			sql`typeof(${table.maxPoints}) = 'integer' AND ${table.maxPoints} > 0`
		)
	]
);

export const resultDefinitions = sqliteTable(
	'result_definition',
	{
		id: id(),
		moduleId: text('module_id')
			.notNull()
			.references(() => modules.id, { onDelete: 'restrict' }),
		title: text('title').notNull(),
		rule: text('rule', { mode: 'json' }).$type<ResultRule>().notNull(),
		position: integer('position').notNull().default(0)
	},
	(table) => [index('result_module_idx').on(table.moduleId)]
);

export const assessmentDeadlines = sqliteTable(
	'assessment_deadline',
	{
		id: id(),
		contextId: text('context_id').notNull(),
		moduleId: text('module_id').notNull(),
		assessmentId: text('assessment_id').notNull(),
		dueAt: timestamp('due_at').notNull(),
		submissionInstructions: text('submission_instructions').notNull().default('')
	},
	(table) => [
		uniqueIndex('deadline_context_assessment_unique').on(table.contextId, table.assessmentId),
		foreignKey({
			columns: [table.contextId, table.moduleId],
			foreignColumns: [teachingContexts.id, teachingContexts.moduleId]
		}).onDelete('cascade'),
		foreignKey({
			columns: [table.assessmentId, table.moduleId],
			foreignColumns: [assessments.id, assessments.moduleId]
		}).onDelete('restrict')
	]
);

export const corrections = sqliteTable(
	'correction',
	{
		id: id(),
		contextId: text('context_id').notNull(),
		moduleId: text('module_id').notNull(),
		studentId: text('student_id')
			.notNull()
			.references(() => students.id, { onDelete: 'cascade' }),
		assessmentId: text('assessment_id').notNull(),
		status: text('status', {
			enum: ['to_evaluate', 'graded', 'absent_unjustified', 'absent_justified']
		})
			.$type<AssessmentStatus>()
			.notNull()
			.default('to_evaluate'),
		submittedAt: timestamp('submitted_at'),
		submissionUrl: text('submission_url'),
		latenessDecision: text('lateness_decision', { enum: ['automatic', 'exempt', 'refused'] })
			.notNull()
			.default('automatic'),
		needsReview: integer('needs_review', { mode: 'boolean' }).notNull().default(false),
		revision: revision()
	},
	(table) => [
		uniqueIndex('correction_context_student_assessment_unique').on(
			table.contextId,
			table.studentId,
			table.assessmentId
		),
		uniqueIndex('correction_id_assessment_unique').on(table.id, table.assessmentId),
		foreignKey({
			columns: [table.contextId, table.moduleId],
			foreignColumns: [teachingContexts.id, teachingContexts.moduleId]
		}).onDelete('cascade'),
		foreignKey({
			columns: [table.assessmentId, table.moduleId],
			foreignColumns: [assessments.id, assessments.moduleId]
		}).onDelete('restrict'),
		check(
			'correction_status_allowed',
			sql`${table.status} IN ('to_evaluate', 'graded', 'absent_unjustified', 'absent_justified')`
		),
		check(
			'correction_lateness_allowed',
			sql`${table.latenessDecision} IN ('automatic', 'exempt', 'refused')`
		),
		check('correction_revision_positive', sql`${table.revision} > 0`)
	]
);

export const scores = sqliteTable(
	'score',
	{
		id: id(),
		correctionId: text('correction_id').notNull(),
		assessmentId: text('assessment_id').notNull(),
		lineId: text('line_id').notNull(),
		points: integer('points')
	},
	(table) => [
		uniqueIndex('score_correction_line_unique').on(table.correctionId, table.lineId),
		foreignKey({
			columns: [table.correctionId, table.assessmentId],
			foreignColumns: [corrections.id, corrections.assessmentId]
		}).onDelete('cascade'),
		foreignKey({
			columns: [table.lineId, table.assessmentId],
			foreignColumns: [rubricLines.id, rubricLines.assessmentId]
		}).onDelete('restrict'),
		// Do not compare to the current maximum: a rubric replacement must preserve old raw points.
		check(
			'score_nonnegative_integer',
			sql`${table.points} IS NULL OR (typeof(${table.points}) = 'integer' AND ${table.points} >= 0)`
		)
	]
);

export const semesterComments = sqliteTable(
	'semester_comment',
	{
		id: id(),
		contextId: text('context_id')
			.notNull()
			.references(() => teachingContexts.id, { onDelete: 'cascade' }),
		studentId: text('student_id')
			.notNull()
			.references(() => students.id, { onDelete: 'cascade' }),
		content: text('content').notNull().default(''),
		revision: revision()
	},
	(table) => [
		uniqueIndex('comment_context_student_unique').on(table.contextId, table.studentId),
		check('comment_revision_positive', sql`${table.revision} > 0`)
	]
);

export const correctionProposals = sqliteTable(
	'correction_proposal',
	{
		id: id(),
		contextId: text('context_id')
			.notNull()
			.references(() => teachingContexts.id, { onDelete: 'cascade' }),
		studentId: text('student_id')
			.notNull()
			.references(() => students.id, { onDelete: 'cascade' }),
		payload: text('payload', { mode: 'json' })
			.$type<CorrectionProposal | AgentProposalPayload>()
			.notNull(),
		teacherId: text('teacher_id').references(() => user.id, { onDelete: 'cascade' }),
		requestId: text('request_id'),
		fingerprint: text('fingerprint'),
		receipt: text('receipt', { mode: 'json' }).$type<ProposalReceipt>(),
		revision: integer('revision').notNull().default(1),
		commentState: text('comment_state', { enum: ['none', 'pending', 'accepted', 'kept'] })
			.notNull()
			.default('none'),
		appliedCorrectionRevision: integer('applied_correction_revision'),
		state: text('state', { enum: ['pending', 'accepted', 'rejected'] })
			.notNull()
			.default('pending'),
		createdAt: createdAt()
	},
	(table) => [
		index('proposal_context_student_idx').on(table.contextId, table.studentId),
		uniqueIndex('proposal_teacher_request_unique').on(table.teacherId, table.requestId),
		check('proposal_revision_positive', sql`${table.revision} > 0`),
		check(
			'proposal_comment_state_allowed',
			sql`${table.commentState} IN ('none', 'pending', 'accepted', 'kept')`
		),
		check('proposal_state_allowed', sql`${table.state} IN ('pending', 'accepted', 'rejected')`)
	]
);

export const modulePublications = sqliteTable(
	'module_publication',
	{
		id: id(),
		contextId: text('context_id')
			.notNull()
			.unique()
			.references(() => teachingContexts.id, { onDelete: 'cascade' }),
		snapshot: text('snapshot', { mode: 'json' })
			.$type<ModulePublication | PublicationSnapshot>()
			.notNull(),
		sourceRevision: integer('source_revision').notNull(),
		sourceContextRevision: integer('source_context_revision').notNull().default(0),
		sourceClassRevision: integer('source_class_revision').notNull().default(0),
		revision: revision(),
		publishedAt: timestamp('published_at').notNull(),
		unpublishedAt: timestamp('unpublished_at')
	},
	(table) => [check('publication_revision_positive', sql`${table.sourceRevision} > 0`)]
);

// Receipts contain durable identities and revisions only, never source text or student results.
export const agentImports = sqliteTable(
	'agent_import',
	{
		id: id(),
		teacherId: text('teacher_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		requestId: text('request_id').notNull(),
		moduleId: text('module_id')
			.notNull()
			.references(() => modules.id, { onDelete: 'restrict' }),
		fingerprint: text('fingerprint').notNull(),
		receipt: text('receipt', { mode: 'json' }).$type<ImportReceipt>().notNull(),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('agent_import_teacher_request_unique').on(table.teacherId, table.requestId)
	]
);

// Decision receipts are purged with the proposal; no accepted scores/comment text are copied here.
export const proposalDecisions = sqliteTable(
	'proposal_decision',
	{
		id: id(),
		proposalId: text('proposal_id')
			.notNull()
			.references(() => correctionProposals.id, { onDelete: 'cascade' }),
		requestId: text('request_id').notNull(),
		fingerprint: text('fingerprint').notNull(),
		receipt: text('receipt', { mode: 'json' }).$type<ProposalDecisionReceipt>().notNull(),
		createdAt: createdAt()
	},
	(table) => [uniqueIndex('proposal_decision_request_unique').on(table.proposalId, table.requestId)]
);

// Publication retries contain only identities, revisions and a hash, never a draft body.
export const publicationReceipts = sqliteTable(
	'publication_receipt',
	{
		id: id(),
		teacherId: text('teacher_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		contextId: text('context_id')
			.notNull()
			.references(() => teachingContexts.id, { onDelete: 'cascade' }),
		requestId: text('request_id').notNull(),
		fingerprint: text('fingerprint').notNull(),
		receipt: text('receipt', { mode: 'json' }).$type<PublicationReceipt>().notNull(),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('publication_receipt_teacher_request_unique').on(table.teacherId, table.requestId)
	]
);
