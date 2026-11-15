import { WorkerEntrypoint } from 'cloudflare:workers';
import { createDatabase, createTursoClient } from '../db/index.js';
import { isQuizTeacherAuthorized } from './teacher-authorization.js';
import { quizTeacherAuthorizationSchema } from './rpc.js';

type AuthorizationEnvironment = Cloudflare.Env & {
	TURSO_DATABASE_URL: string;
	TURSO_AUTH_TOKEN: string;
};

export class QuizAuthorization extends WorkerEntrypoint<AuthorizationEnvironment> {
	async canReadTeacher(value: unknown): Promise<boolean> {
		const checked = quizTeacherAuthorizationSchema.safeParse(value);
		if (!checked.success) return false;
		const client = createTursoClient(this.env.TURSO_DATABASE_URL, this.env.TURSO_AUTH_TOKEN);
		try {
			return await isQuizTeacherAuthorized(createDatabase(client), checked.data);
		} finally {
			client.close();
		}
	}
}
