import { classInputSchema } from '#lib/domain/teaching.js';
import { teachingEndpoint } from '#lib/server/teaching/http.js';
import { createClass } from '#lib/server/teaching/service.js';
export const POST = teachingEndpoint(classInputSchema, (db, input) => createClass(db, input));
