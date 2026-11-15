import type { Database } from '../index.js';
import * as schema from '../schema.js';
import { modulePublicationSchema, resultRuleSchema, correctionProposalSchema } from '../../../domain/contracts.js';

// Explicitly fictional data, used only by local tests and the opt-in local fixture command.
export async function seedFoundationFixtures(db: Database) {
	const ids = {
		teacher: crypto.randomUUID(),
		module: crypto.randomUUID(),
		secondModule: crypto.randomUUID(),
		currentClass: crypto.randomUUID(),
		oldClass: crypto.randomUUID(),
		currentContext: crypto.randomUUID(),
		oldContext: crypto.randomUUID(),
		secondContext: crypto.randomUUID(),
		quiz: crypto.randomUUID(),
		project: crypto.randomUUID(),
		oral: crypto.randomUUID(),
		group: crypto.randomUUID(),
		firstLine: crypto.randomUUID(),
		secondLine: crypto.randomUUID(),
		correction: crypto.randomUUID(),
		oldCorrection: crypto.randomUUID(),
		resource: crypto.randomUUID(),
		students: Array.from({ length: 12 }, () => crypto.randomUUID()),
		oldStudent: crypto.randomUUID()
	};
	const now = new Date('2026-10-12T08:00:00Z');
	await db.transaction(async (tx) => {
		await tx.insert(schema.user).values({
			id: ids.teacher,
			name: 'Teacher Demo',
			email: 'teacher@example.test',
			role: 'teacher',
			createdAt: now,
			updatedAt: now
		});
		await tx.insert(schema.modules).values([
			{
				id: ids.module,
				title: 'Demo · Application web',
				description: 'Fictional module for local verification.',
				preparation: {
					framing: 'Teacher-only preparation.',
					nextSteps: 'Review selected materials.',
					sourceLinks: []
				}
			},
			{ id: ids.secondModule, title: 'Demo · Independent module' }
		]);
		await tx.insert(schema.classes).values([
			{ id: ids.currentClass, name: 'B2 Demo', academicYear: '2026-2027' },
			{ id: ids.oldClass, name: 'B2 Demo', academicYear: '2025-2026' }
		]);
		await tx.insert(schema.students).values([
			...ids.students.map((id, position) => ({
				id,
				classId: ids.currentClass,
				name: `Student Demo ${position + 1}`,
				position
			})),
			{ id: ids.oldStudent, classId: ids.oldClass, name: 'Old Student Demo' }
		]);
		await tx.insert(schema.teachingContexts).values([
			{
				id: ids.currentContext,
				moduleId: ids.module,
				classId: ids.currentClass,
				className: 'B2 Demo',
				academicYear: '2026-2027'
			},
			{
				id: ids.oldContext,
				moduleId: ids.module,
				classId: ids.oldClass,
				className: 'B2 Demo',
				academicYear: '2025-2026',
				archivedAt: now
			},
			{
				id: ids.secondContext,
				moduleId: ids.secondModule,
				classId: ids.currentClass,
				className: 'B2 Demo',
				academicYear: '2026-2027'
			}
		]);
		await tx.insert(schema.lessons).values({
			contextId: ids.oldContext,
			title: 'Demo · Preserved lesson',
			startsAt: new Date('2025-10-13T08:00:00Z'),
			endsAt: new Date('2025-10-13T10:00:00Z')
		});
		await tx.insert(schema.resources).values({
			id: ids.resource,
			moduleId: ids.module,
			label: 'Demo · Course PDF',
			url: 'https://example.test/course.pdf',
			kind: 'course'
		});
		await tx.insert(schema.assessments).values([
			{ id: ids.quiz, moduleId: ids.module, title: 'Quiz Demo', kind: 'quiz', position: 0 },
			{
				id: ids.project,
				moduleId: ids.module,
				title: 'Project Demo',
				kind: 'project',
				position: 1
			},
			{ id: ids.oral, moduleId: ids.module, title: 'Oral Demo', kind: 'oral', position: 2 }
		]);
		await tx.insert(schema.rubricGroups).values({ id: ids.group, assessmentId: ids.project, title: 'Features' });
		await tx.insert(schema.rubricLines).values([
			{
				id: ids.firstLine,
				assessmentId: ids.project,
				groupId: ids.group,
				label: 'First feature',
				maxPoints: 10
			},
			{
				id: ids.secondLine,
				assessmentId: ids.project,
				groupId: ids.group,
				label: 'Second feature',
				maxPoints: 10,
				position: 1
			}
		]);
		await tx.insert(schema.resultDefinitions).values({
			moduleId: ids.module,
			title: 'Final result',
			rule: resultRuleSchema.parse({
				kind: 'weighted',
				components: [
					{ assessmentIds: [ids.quiz], weight: 15 },
					{ assessmentIds: [ids.project], weight: 25 },
					{ assessmentIds: [ids.oral], weight: 60 }
				]
			})
		});
		await tx.insert(schema.assessmentDeadlines).values({
			contextId: ids.oldContext,
			moduleId: ids.module,
			assessmentId: ids.project,
			dueAt: new Date('2025-11-01T17:00:00Z'),
			submissionInstructions: 'Use the external repository.'
		});
		await tx.insert(schema.corrections).values([
			{
				id: ids.correction,
				contextId: ids.currentContext,
				moduleId: ids.module,
				studentId: ids.students[0],
				assessmentId: ids.project,
				status: 'graded',
				submissionUrl: 'https://example.test/demo-repository'
			},
			{
				id: ids.oldCorrection,
				contextId: ids.oldContext,
				moduleId: ids.module,
				studentId: ids.oldStudent,
				assessmentId: ids.project,
				status: 'graded',
				submissionUrl: 'https://example.test/old-repository'
			}
		]);
		await tx.insert(schema.scores).values([
			{ correctionId: ids.correction, assessmentId: ids.project, lineId: ids.firstLine, points: 8 },
			{
				correctionId: ids.correction,
				assessmentId: ids.project,
				lineId: ids.secondLine,
				points: 6
			},
			{
				correctionId: ids.oldCorrection,
				assessmentId: ids.project,
				lineId: ids.firstLine,
				points: 7
			}
		]);
		await tx.insert(schema.semesterComments).values({
			contextId: ids.oldContext,
			studentId: ids.oldStudent,
			content: 'Private fictional semester comment.'
		});
		await tx.insert(schema.correctionProposals).values({
			contextId: ids.oldContext,
			studentId: ids.oldStudent,
			payload: correctionProposalSchema.parse({
				version: 1,
				contextId: ids.oldContext,
				studentId: ids.oldStudent,
				assessmentId: ids.project,
				rubricRevision: 1,
				correctionRevision: 1,
				scores: [{ lineId: ids.firstLine, points: 9 }],
				semesterComment: 'Private proposal.'
			})
		});
		await tx.insert(schema.modulePublications).values({
			contextId: ids.oldContext,
			sourceRevision: 1,
			publishedAt: now,
			snapshot: modulePublicationSchema.parse({
				version: 1,
				title: 'Demo · Application web',
				description: 'Selected student material only.',
				resources: [
					{
						id: ids.resource,
						label: 'Demo · Course PDF',
						url: 'https://example.test/course.pdf',
						kind: 'course'
					}
				],
				deadlines: [],
				recap: '',
				toDo: ''
			})
		});
	});
	return ids;
}
