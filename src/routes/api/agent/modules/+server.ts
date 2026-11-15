import { createModuleImportSchema } from '#lib/domain/module-import.js';
import { agentWrite } from '#lib/server/agent/http.js';
import { importModule } from '#lib/server/agent/import.js';
export const POST = agentWrite('create', createModuleImportSchema, (db, teacherId, input) =>
	importModule(db, teacherId, 'create', input)
);
