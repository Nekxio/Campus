import { z } from 'zod';
import { academicYearSchema, idSchema } from '../../domain/contracts.js';
import {
	classUpdateSchema,
	studentUpdateSchema,
	studentDeleteSchema,
	attachModuleSchema
} from '../../domain/teaching.js';
import { correctionWriteSchema, semesterCommentWriteSchema } from '../../domain/grading.js';
import { proposalDecisionActionSchema } from '../../domain/proposals.js';
import { publicationDecisionSchema } from '../../domain/publication.js';
import { annualActionSchema } from '../../domain/annual.js';
import { calendarCommandSchema } from '../../domain/calendar-subscription.js';
import { quizDraftWriteSchema } from '../../domain/quiz-content.js';
import type { McpScope } from '../../domain/remote-mcp.js';
import type { Database } from '../db/index.js';
import type { McpPrincipal } from './principal.js';
import {
	getHomeData,
	getClassesData,
	listModules,
	updateClass,
	changeStudent,
	attachModule
} from '../teaching/service.js';
import { getGradeGrid, saveCorrection, saveSemesterComment } from '../teaching/grading.js';
import { getProposalReview, decideCorrectionProposal } from '../teaching/proposals.js';
import { getFinalGradeExport, getStudentGradeExport } from '../teaching/grade-export.js';
import { getPublicationReview, decidePublication, getPublicClass, getPublicModule } from '../teaching/publications.js';
import { listPublishedClasses } from '../teaching/student-views.js';
import { getAnnualData, getAnnualHistory, decideAnnualYear } from '../teaching/annual.js';
import { getCalendarSettings } from '../calendar/state.js';
import { calendarCommand, syncCalendarIfDue } from '../calendar/service.js';
import { saveQuizDraft } from '../teaching/quizzes.js';
import { listPublicQuizzes } from '../teaching/quiz-public.js';

export const teachingToolScopes = {
	get_teacher_home: ['modules:read'],
	get_classes: ['modules:read', 'roster:manage'],
	list_modules: ['modules:read'],
	update_class: ['modules:read', 'roster:update'],
	update_student: ['modules:read', 'roster:update'],
	delete_student: ['modules:read', 'roster:delete'],
	attach_module: ['modules:read', 'modules:create', 'modules:update', 'roster:update'],
	get_grade_grid: ['modules:read', 'grades:read'],
	save_correction: ['modules:read', 'grades:read', 'grades:write'],
	save_semester_comment: ['modules:read', 'grades:read', 'grades:write'],
	get_proposal_review: ['modules:read', 'grades:read'],
	decide_correction_proposal: ['modules:read', 'grades:read', 'grades:write'],
	get_class_grade_export: ['modules:read', 'grades:read'],
	get_student_grade_export: ['modules:read', 'grades:read'],
	get_publication_review: ['modules:read'],
	decide_publication: ['modules:read', 'publications:write'],
	list_published_classes: ['modules:read'],
	get_public_class: ['modules:read'],
	get_public_module: ['modules:read'],
	list_public_quizzes: ['modules:read'],
	get_annual_data: ['modules:read', 'annual:read'],
	get_annual_history: ['modules:read', 'annual:read', 'grades:read'],
	decide_annual_year: ['modules:read', 'annual:read', 'annual:write'],
	get_calendar_settings: ['modules:read', 'calendar:read'],
	calendar_command: ['modules:read', 'calendar:read', 'calendar:write'],
	save_quiz_draft: ['modules:read', 'quizzes:read', 'quizzes:write', 'quizzes:review']
} satisfies Record<string, McpScope[]>;

export type TeachingToolName = keyof typeof teachingToolScopes;
type RegisterTool = <S extends z.ZodObject>(
	name: TeachingToolName,
	schema: S,
	description: string,
	operation: (input: z.output<S>) => Promise<unknown>,
	readOnly?: boolean,
	idempotent?: boolean
) => void;
export type TeachingToolDependencies = {
	purgeQuizRuns?: (runIds: readonly string[]) => Promise<readonly string[]>;
};

export const registerTeachingTools = (
	tool: RegisterTool,
	db: Database,
	principal: McpPrincipal,
	dependencies: TeachingToolDependencies
) => {
	const { teacherId } = principal;
	tool(
		'get_teacher_home',
		z.strictObject({
			month: z
				.string()
				.regex(/^\d{4}-(0[1-9]|1[0-2])$/)
				.optional()
		}),
		'Read the teaching home, upcoming lesson and calendar month. Excludes the teacher account.',
		({ month }) => getHomeData(db, new Date(), month),
		true
	);
	tool(
		'get_classes',
		z.strictObject({ classId: idSchema.optional() }),
		'List annual classes and modules; optionally read the exact selected roster. No grades.',
		({ classId }) => getClassesData(db, classId),
		true
	);
	tool(
		'list_modules',
		z.strictObject({}),
		'List module summaries and class associations without student identities or grades.',
		async () => ({ modules: await listModules(db) }),
		true
	);
	tool(
		'update_class',
		classUpdateSchema.extend({ classId: idSchema }),
		'Rename an exact class using its current revision and existing academic year. Reread after a conflict or lost response before another write.',
		({ classId, ...input }) => updateClass(db, classId, input),
		false,
		false
	);
	tool(
		'update_student',
		studentUpdateSchema.extend({ classId: idSchema, studentId: idSchema }),
		'Rename an exact student using current student and class revisions. No account changes. Reread after a conflict or lost response.',
		({ classId, studentId, ...input }) => changeStudent(db, classId, studentId, input),
		false,
		false
	);
	tool(
		'delete_student',
		studentDeleteSchema.extend({ classId: idSchema, studentId: idSchema }),
		'Delete an exact student and associated annual data only after explicit user approval. Requires confirm=true and current student/class revisions. Reread after a lost response.',
		({ classId, studentId, ...input }) => changeStudent(db, classId, studentId, input),
		false,
		false
	);
	tool(
		'attach_module',
		attachModuleSchema.extend({ classId: idSchema }),
		'Attach or recover a module for the exact class. An already assigned module produces an independent teaching copy without students or grades. Requires current module/class revisions. Reread after a lost response; never blindly repeat a copy.',
		({ classId, ...input }) => attachModule(db, classId, input),
		false,
		false
	);
	tool(
		'get_grade_grid',
		z.strictObject({ moduleId: idSchema, contextId: idSchema, includeArchived: z.boolean().default(false) }),
		'Read the full grading grid, private comments and rubric for an exact module/context. Explicit bulk grade consent required.',
		({ moduleId, contextId, includeArchived }) =>
			db.transaction((tx) => getGradeGrid(tx, moduleId, contextId, includeArchived)),
		true
	);
	tool(
		'save_correction',
		correctionWriteSchema.safeExtend({ contextId: idSchema, studentId: idSchema, assessmentId: idSchema }),
		'Write the selected assessment correction, scores, submission and lateness decision using current rubric/correction revisions. Reread after conflict or lost response.',
		({ contextId, studentId, assessmentId, ...input }) => saveCorrection(db, contextId, studentId, assessmentId, input),
		false,
		false
	);
	tool(
		'save_semester_comment',
		semesterCommentWriteSchema.extend({ contextId: idSchema, studentId: idSchema }),
		'Save one private semester comment separately from scores using its current revision. Reread after conflict or lost response.',
		({ contextId, studentId, ...input }) => saveSemesterComment(db, contextId, studentId, input),
		false,
		false
	);
	tool(
		'get_proposal_review',
		z.strictObject({ proposalId: idSchema.optional(), contextId: idSchema.optional() }),
		'Read the private proposal queue and selected saved/proposed comparison before deciding it.',
		({ proposalId, contextId }) => db.transaction((tx) => getProposalReview(tx, proposalId, contextId)),
		true
	);
	tool(
		'decide_correction_proposal',
		proposalDecisionActionSchema,
		'Apply explicit points and comment decisions from a reviewed private correction proposal. Preserve exact revisions and retry request ID.',
		({ proposalId, decision }) => decideCorrectionProposal(db, proposalId, decision)
	);
	tool(
		'get_class_grade_export',
		z.strictObject({ contextId: idSchema }),
		'Read the validated complete-class final PDF data projection. Incomplete results are refused. Returns document data; PDF rendering remains client-side.',
		async ({ contextId }) => ({ document: await getFinalGradeExport(db, contextId) }),
		true
	);
	tool(
		'get_student_grade_export',
		z.strictObject({ contextId: idSchema, studentId: idSchema }),
		'Read the validated selected student final PDF projection, without private comments. Incomplete results are refused. Returns document data.',
		async ({ contextId, studentId }) => ({ document: await getStudentGradeExport(db, contextId, studentId) }),
		true
	);
	tool(
		'get_publication_review',
		z.strictObject({ moduleId: idSchema, contextId: idSchema.optional() }),
		'Read the exact private draft/public snapshot comparison and all revisions required for an explicit publication decision.',
		({ moduleId, contextId }) => db.transaction((tx) => getPublicationReview(tx, moduleId, contextId)),
		true
	);
	tool(
		'decide_publication',
		publicationDecisionSchema.extend({ moduleId: idSchema }),
		'Publish or unpublish only after explicit user instruction and review of get_publication_review. Requires all current revisions, confirm=true and stable requestId. Draft imports never call this operation automatically.',
		({ moduleId, ...input }) => decidePublication(db, teacherId, moduleId, input)
	);
	tool(
		'list_published_classes',
		z.strictObject({}),
		'List validated public class directories without grades or private student records.',
		async () => ({ classes: await listPublishedClasses(db) }),
		true
	);
	tool(
		'get_public_class',
		z.strictObject({ publicClassId: idSchema }),
		'Read the validated public class directory using its public identity.',
		({ publicClassId }) => getPublicClass(db, publicClassId),
		true
	);
	tool(
		'get_public_module',
		z.strictObject({ publicContextId: idSchema }),
		'Read only the validated published module snapshot using its public identity. Never falls back to private drafts.',
		({ publicContextId }) => getPublicModule(db, publicContextId),
		true
	);
	tool(
		'list_public_quizzes',
		z.strictObject({ publicContextId: idSchema }),
		'List the student-facing published quiz summaries and room availability, without answer keys or private roster.',
		async ({ publicContextId }) => ({ quizzes: await listPublicQuizzes(db, publicContextId) }),
		true
	);
	tool(
		'get_annual_data',
		z.strictObject({ academicYear: academicYearSchema.optional() }),
		'List years and read the selected annual lifecycle review, counts and reviewToken before any archive, reopen or purge.',
		({ academicYear }) => getAnnualData(db, teacherId, academicYear),
		true
	);
	tool(
		'get_annual_history',
		z.strictObject({ academicYear: academicYearSchema, contextId: idSchema }),
		'Read the exact year/context teaching history and retained private grading grid.',
		({ academicYear, contextId }) => getAnnualHistory(db, academicYear, contextId),
		true
	);
	tool(
		'decide_annual_year',
		z.strictObject({ command: annualActionSchema }),
		'Archive, reopen or purge an explicitly selected annual dossier after user approval. Keep the reviewed token and retry requestId. Purge additionally requires annual:purge, exact typedYear, confirmation that PDFs were kept, and a continue/pause choice for every module. Never invent these confirmations.',
		({ command }) => decideAnnualYear(db, teacherId, command, { purgeQuizRuns: dependencies.purgeQuizRuns })
	);
	tool(
		'get_calendar_settings',
		z.strictObject({}),
		'Read teaching calendar events, mappings and sync state without revealing the private feed URL.',
		() => getCalendarSettings(db, teacherId),
		true
	);
	tool(
		'calendar_command',
		z.strictObject({ command: calendarCommandSchema }),
		'Preview, connect, synchronize or disconnect the teaching calendar through the same checked app workflow. Feed URL is input only and never returned. Read current calendar settings first. Reread after a lost response.',
		({ command }) =>
			command.action === 'sync' && !command.manual
				? syncCalendarIfDue(db, teacherId, false).then((changed) => ({ changed }))
				: calendarCommand(db, teacherId, command),
		false,
		false
	);
	tool(
		'save_quiz_draft',
		z.strictObject({ quiz: quizDraftWriteSchema, confirmReview: z.literal(true) }),
		'Explicitly save the full reviewed quiz and clear its review marker using current revision and stable requestId. Requires quizzes:review; ordinary agent draft imports remain marked for review. Frozen quizzes cannot change.',
		({ quiz }) => saveQuizDraft(db, teacherId, quiz)
	);
};
