import { withAuth } from '#lib/server/auth/runtime.js';
import { handleRemoteMcp } from '#lib/server/mcp/http.js';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = ({ request }) =>
	withAuth((auth, client, origin) => handleRemoteMcp(request, auth, client, origin));
export const GET = POST;
export const DELETE = POST;
export const OPTIONS = POST;
