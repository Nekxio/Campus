import { withAuth } from '#lib/server/auth/runtime.js';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = ({ request }) => withAuth((auth) => auth.handler(request));
