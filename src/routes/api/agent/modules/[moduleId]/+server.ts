import { updateModuleImportSchema } from '#lib/domain/module-import.js';
import { agentWrite } from '#lib/server/agent/http.js';
import { importModule } from '#lib/server/agent/import.js';
import { teachingId } from '#lib/server/teaching/http.js';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { patchModuleImportSchema } from '#lib/domain/module-patch.js';
import { patchModule } from '#lib/server/agent/patch.js';
export const PATCH: RequestHandler = (event) =>
	agentWrite('update', z.union([patchModuleImportSchema, updateModuleImportSchema]), (db, teacherId, input) => {
		if (input.moduleId !== teachingId(event.params.moduleId)) error(422, 'Identifiant de module incompatible.');
		return input.version === 2 ? patchModule(db, teacherId, input) : importModule(db, teacherId, 'update', input);
	})(event);
