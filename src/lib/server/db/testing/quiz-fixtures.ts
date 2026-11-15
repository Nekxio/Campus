import { eq } from 'drizzle-orm';
import type { Database } from '../index.js';
import { assessments, lessons, quizRuns, rubricGroups, rubricLines } from '../schema.js';
import { getQuizGradeBaselines, saveQuizDraft } from '../../teaching/quizzes.js';
import type { QuizContent } from '../../../domain/quiz-content.js';

export const seedNativeQuizFixtures = async (
	db: Database,
	ids: { teacher: string; publicationModule: string; publicationContext: string },
	createUiRun = false
) => {
	const assessmentId = crypto.randomUUID();
	const groupId = crypto.randomUUID();
	const lineId = crypto.randomUUID();
	const quizId = crypto.randomUUID();
	const runId = crypto.randomUUID();
	const [lesson] = await db.select().from(lessons).where(eq(lessons.contextId, ids.publicationContext));
	if (!lesson) throw new Error('The fictional published context needs a lesson.');
	const question = (type: 'single' | 'multiple' | 'true_false', prompt: string) => {
		const options = [
			{ id: crypto.randomUUID(), text: type === 'true_false' ? 'Vrai' : 'Première option' },
			{ id: crypto.randomUUID(), text: type === 'true_false' ? 'Faux' : 'Deuxième option' }
		];
		return {
			id: crypto.randomUUID(),
			type,
			prompt,
			code: '',
			codeLanguage: '',
			options,
			correctOptionIds: type === 'multiple' ? options.map((option) => option.id) : [options[0].id]
		};
	};
	const content: QuizContent = {
		version: 1,
		title: 'Quiz fictif · Lire et comprendre le code',
		durationSeconds: 600,
		questions: [
			{
				...question('single', 'Que renvoie cette fonction ?'),
				code: 'const add = (first, second) => first + second;\nadd(2, 3);',
				codeLanguage: 'javascript'
			},
			question('multiple', 'Quels choix correspondent au contrat ?'),
			question('true_false', 'Une question sans réponse vaut zéro.')
		]
	};
	await db.transaction(async (tx) => {
		await tx.insert(assessments).values({
			id: assessmentId,
			moduleId: ids.publicationModule,
			title: 'Quiz fictifs',
			kind: 'quiz',
			purpose: 'graded',
			position: 99
		});
		await tx.insert(rubricGroups).values({ id: groupId, assessmentId, title: 'Quiz' });
		await tx.insert(rubricLines).values({
			id: lineId,
			assessmentId,
			groupId,
			label: content.title,
			maxPoints: content.questions.length
		});
	});
	const receipt = await saveQuizDraft(db, ids.teacher, {
		id: quizId,
		requestId: crypto.randomUUID(),
		moduleId: ids.publicationModule,
		contextId: ids.publicationContext,
		lessonId: lesson.id,
		assessmentId,
		lineId,
		expectedRevision: 0,
		content
	});
	const baselines = await getQuizGradeBaselines(db, quizId);
	if (createUiRun)
		await db.insert(quizRuns).values({
			id: runId,
			quizId,
			contextId: ids.publicationContext,
			teacherId: ids.teacher,
			quizRevision: receipt.revision,
			openingFingerprint: 'fictional-ui-run',
			shuffleSeed: 'fictional-ui-run',
			gradeBaselines: baselines.map((entry) => ({
				studentId: entry.studentId,
				name: entry.name,
				correctionRevision: entry.correctionRevision,
				requestId: crypto.randomUUID()
			}))
		});
	return {
		quizId,
		quizRevision: receipt.revision,
		runId,
		contextId: ids.publicationContext,
		moduleId: ids.publicationModule,
		content,
		roster: baselines.map((entry) => ({ id: entry.studentId, name: entry.name }))
	};
};
export type NativeQuizFixture = Awaited<ReturnType<typeof seedNativeQuizFixtures>>;
