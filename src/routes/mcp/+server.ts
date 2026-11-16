import { withAuth } from '#lib/server/auth/runtime.js';
import { handleRemoteMcp } from '#lib/server/mcp/http.js';
import type { RequestHandler } from './$types';
import { quizRoomStub } from '#lib/server/quizzes/http.js';
export const POST: RequestHandler = (event) =>
	withAuth((auth, client, origin) =>
		handleRemoteMcp(event.request, auth, client, origin, {
			purgeQuizRuns: async (ids) => {
				for (const id of ids) await quizRoomStub(event, id).purge();
				return ids;
			}
		})
	);
export const GET = POST;
export const DELETE = POST;
export const OPTIONS = POST;
