import { eq } from 'drizzle-orm';
import { quizSessionCommandSchema } from '#lib/domain/quiz-session.js';
import { requireTeacher } from '#lib/server/auth/access.js';
import { publicModuleLinks, teachingContexts } from '#lib/server/db/schema.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { getQuizDraft } from '#lib/server/teaching/quizzes.js';
import { commandQuizRoom, requireQuizRun } from '#lib/server/teaching/quiz-rooms.js';
import { quizEndpoint, quizJson, quizRoomStub, quizTeacherWrite, requireQuizOrigin } from '#lib/server/quizzes/http.js';

export const GET = quizEndpoint(async (event) => {
	const teacher = requireTeacher(event.locals);
	const upgrade = event.request.headers.get('upgrade')?.toLowerCase() === 'websocket';
	if (upgrade) requireQuizOrigin(event);
	const data = await withTeacherDatabase(event.locals, async (db) => {
		const run = await requireQuizRun(db, event.params.runId!, teacher.id);
		const quiz = await getQuizDraft(db, run.quizId);
		const [context] = await db.select().from(teachingContexts).where(eq(teachingContexts.id, run.contextId));
		const [link] = await db
			.select({ id: publicModuleLinks.id })
			.from(publicModuleLinks)
			.where(eq(publicModuleLinks.contextId, context.id));
		return {
			run: {
				id: run.id,
				quizId: run.quizId,
				contextId: run.contextId,
				sourceRunId: run.sourceRunId
			},
			quiz: {
				id: quiz.id,
				title: quiz.content.title,
				moduleId: quiz.moduleId,
				lessonId: quiz.lessonId
			},
			context: {
				id: context.id,
				publicContextId: link?.id ?? context.id,
				className: context.className,
				academicYear: context.academicYear
			}
		};
	});
	const stub = quizRoomStub(event, data.run.id);
	if (upgrade)
		return stub.fetch(
			new Request('https://quiz-room.internal/socket', {
				headers: {
					Upgrade: 'websocket',
					'x-campus-quiz-actor': '{"kind":"teacher"}',
					'x-campus-quiz-teacher': JSON.stringify({
						teacherId: teacher.id,
						sessionId: event.locals.session!.id
					}),
					'x-campus-quiz-issued-at': String(Date.now()),
					'x-campus-quiz-expires-at': String(event.locals.session!.expiresAt.getTime())
				}
			})
		);
	return quizJson({ ...data, view: await stub.teacherState() });
});

export const POST = quizTeacherWrite(quizSessionCommandSchema, (db, event, input) =>
	commandQuizRoom(db, (id) => quizRoomStub(event, id), requireTeacher(event.locals).id, event.params.runId!, input)
);
