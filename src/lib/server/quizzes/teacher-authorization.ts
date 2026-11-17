import { isHttpError } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { session, user } from '../db/schema.js';
import { requireQuizRun } from '../teaching/quiz-rooms.js';
import { quizTeacherAuthorizationSchema } from './rpc.js';

export const isQuizTeacherAuthorized = async (db: Pick<Database, 'select'>, value: unknown): Promise<boolean> => {
	const checked = quizTeacherAuthorizationSchema.safeParse(value);
	if (!checked.success) return false;
	const input = checked.data;
	const [current] = await db
		.select({ id: session.id })
		.from(session)
		.innerJoin(user, eq(user.id, session.userId))
		.where(
			and(
				eq(session.id, input.sessionId),
				eq(session.userId, input.teacherId),
				eq(user.role, 'teacher'),
				gt(session.expiresAt, new Date())
			)
		)
		.limit(1);
	if (!current) return false;
	try {
		await requireQuizRun(db, input.runId, input.teacherId);
		return true;
	} catch (cause) {
		if (isHttpError(cause) && (cause.status === 404 || cause.status === 409)) return false;
		throw cause;
	}
};
